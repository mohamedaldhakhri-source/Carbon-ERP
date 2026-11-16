-- Permissions editable per role (migration 033) and BOQ items added by hand (032). Run after e2e_workflow.sql
-- on the same scratch database (never against the live project).
set role authenticated;
select public.t_s('perms');
create temp table if not exists v(k text primary key, id uuid);
grant all on v to authenticated;

-- only the system admin edits permissions
select public.t_as('gm');
select public.t_no('المدير العام ما يقدر يعدل الصلاحيات', $$select public.set_role_perm('pc.approve','site',true)$$);

-- default: an item added by the department head waits for the GM and the owner
select public.t_as('head');
select public.t_ok('رئيس القسم يضيف بند BOQ', $$insert into v select 'b1', public.add_boq_item((select id from public.projects limit 1),'1',null,'P.900','بند تجربة',2,'عدد',10,'contracting')$$);
select public.t_eq('البند بانتظار الموافقة', $$select approval from public.boq_items where id=(select id from v where k='b1')$$, 'pending');
select public.t_no('رئيس القسم ما يعتمد البند', $$select public.decide_boq_item((select id from v where k='b1'), true)$$);
select public.t_as('gm');
select public.t_eq('موافقة المدير العام وحدها ما تكفي', $$select public.decide_boq_item((select id from v where k='b1'), true)$$, 'pending');
select public.t_as('owner');
select public.t_eq('بعد موافقة صاحب الشركة ينضاف', $$select public.decide_boq_item((select id from v where k='b1'), true)$$, 'approved');

-- the admin drops the GM from BOQ approvals: the owner alone decides, and a waiting item goes through once the rule changes
select public.t_as('head');
select public.t_ok('بند ثاني', $$insert into v select 'b2', public.add_boq_item((select id from public.projects limit 1),'1',null,'P.901','بند تجربة 2',1,'عدد',5,'contracting')$$);
select public.t_as('owner');
select public.t_eq('صاحب الشركة يوافق والمدير العام باقي', $$select public.decide_boq_item((select id from v where k='b2'), true)$$, 'pending');
select public.t_as('admin');
select public.t_ok('مدير النظام يشيل المدير العام من اعتماد البنود', $$select public.set_role_perm('boq.approve','gm',false)$$);
select public.t_eq('البند المعلق اعتمد بعد تغيير القاعدة', $$select approval from public.boq_items where id=(select id from v where k='b2')$$, 'approved');
select public.t_as('owner');
select public.t_ok('صاحب الشركة يضيف بند', $$insert into v select 'b3', public.add_boq_item((select id from public.projects limit 1),'1',null,'P.902','بند تجربة 3',1,'عدد',5,null)$$);
select public.t_eq('بند صاحب الشركة معتمد مباشرة', $$select approval from public.boq_items where id=(select id from v where k='b3')$$, 'approved');
select public.t_as('gm');
select public.t_ok('المدير العام لسه يضيف بنود', $$insert into v select 'b4', public.add_boq_item((select id from public.projects limit 1),'1',null,'P.903','بند تجربة 4',1,'عدد',5,null)$$);
select public.t_no('المدير العام ما يعتمد بعد الحين', $$select public.decide_boq_item((select id from v where k='b4'), true)$$);

-- petty cash approval moved from the GM to the owner
select public.t_as('admin');
select public.t_ok('اعتماد البيتي كاش لصاحب الشركة', $$select public.set_role_perm('pc.approve','owner',true), public.set_role_perm('pc.approve','gm',false)$$);
select public.t_as('site');
select public.t_ok('طلب بيتي كاش', $$insert into public.petty_cash(project_id,amount,description,requested_by) select id,12,'تجربة صلاحيات',public.t_id('site') from public.projects limit 1$$);
select public.t_as('gm');
select public.t_no('المدير العام ما يعتمد البيتي كاش', $$select public.decide_petty((select id from public.petty_cash where description='تجربة صلاحيات'), true)$$);
select public.t_as('owner');
select public.t_ok('صاحب الشركة يعتمد البيتي كاش', $$select public.decide_petty((select id from public.petty_cash where description='تجربة صلاحيات'), true)$$);
select public.t_eq('البيتي كاش معتمد', $$select status from public.petty_cash where description='تجربة صلاحيات'$$, 'approved');

-- request steps switched off: no department approval and no QS review
select public.t_as('admin');
select public.t_ok('إيقاف خطوة رئيس القسم ومراجعة QS', $$select public.set_role_perm('mr.head','head',false), public.set_role_perm('mr.qs','qs',false)$$);
select public.t_as('site');
select public.t_ok('طلب مواد بدون رئيس القسم', $$with x as (insert into public.material_requests(project_id,dept,requested_by,note) select id,'contracting',public.t_id('site'),'تجربة خطوات' from public.projects limit 1 returning id) insert into v select 'r1', id from x$$);
select public.t_ok('مادة', $$insert into public.request_items(request_id,description,qty) values ((select id from v where k='r1'),'اسمنت',5)$$);
select public.t_ok('الطلب يروح للمشتريات مباشرة', $$select public.start_proc_request((select id from v where k='r1'))$$);
select public.t_as('head');
select public.t_no('رئيس القسم ما عاد يقدر يتصرف', $$select public.advance_request((select id from v where k='r1'))$$);
select public.t_as('proc');
select public.t_ok('سعر', $$select public.set_request_items((select id from v where k='r1'), jsonb_build_array(jsonb_build_object('id',(select id from public.request_items where request_id=(select id from v where k='r1')),'price','3')))$$);
select public.t_ok('مورد', $$insert into public.suppliers(name,cr_no,cr_path,phone) select 'مورد تجربة','999','a','1' where not exists (select 1 from public.suppliers)$$);
select public.t_ok('عرض', $$insert into public.quotes(request_id,supplier,supplier_id,amount,terms,selected,file_path) values ((select id from v where k='r1'),'x',(select id from public.suppliers limit 1),15,'advance',true,'q.pdf')$$);
select public.t_eq('بعد التسعير يروح للاعتماد النهائي مباشرة', $$select public.advance_request((select id from v where k='r1'))$$, 'gm');

-- put everything back
select public.t_as('admin');
select public.t_ok('رجوع الإعدادات', $$select public.set_role_perm('boq.approve','gm',true), public.set_role_perm('pc.approve','gm',true), public.set_role_perm('pc.approve','owner',false), public.set_role_perm('mr.head','head',true), public.set_role_perm('mr.qs','qs',true)$$);
select public.t_no('صلاحية غير معروفة مرفوضة', $$select public.set_role_perm('x.y','gm',true)$$);
reset role;
