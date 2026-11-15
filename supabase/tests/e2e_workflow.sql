-- End-to-end test of the Carbon ERP database: every role, the full workflows, and permission checks.
\set ON_ERROR_STOP on
create table public.t_res(n serial, sec text, label text, ok bool, detail text);
create table public.t_users(name text primary key, id uuid);
grant all on public.t_res to authenticated; grant usage on sequence public.t_res_n_seq to authenticated; grant select on public.t_users to authenticated;
create table public.t_sec(s text); insert into public.t_sec values ('');grant all on public.t_sec to authenticated;

create function public.t_as(p text) returns void language plpgsql as $$
begin perform set_config('app.uid', (select id::text from public.t_users where name = p), false); end $$;
create function public.t_id(p text) returns uuid language sql as $$ select id from public.t_users where name = p $$;
create function public.t_s(p text) returns void language sql as $$ update public.t_sec set s = p $$;
create function public.t_rec(l text, ok bool, d text) returns void language sql as $$ insert into public.t_res(sec,label,ok,detail) select s,l,ok,d from public.t_sec $$;
-- must succeed
create function public.t_ok(l text, q text) returns void language plpgsql as $$
begin execute q; perform public.t_rec(l, true, null);
exception when others then perform public.t_rec(l, false, sqlerrm); end $$;
-- must be refused (error, or no row changed)
create function public.t_no(l text, q text) returns void language plpgsql as $$
declare rc int;
begin execute q; get diagnostics rc = row_count;
  if rc = 0 then perform public.t_rec(l, true, 'blocked: no rows'); else perform public.t_rec(l, false, 'NOT blocked, rows=' || rc); end if;
exception when others then perform public.t_rec(l, true, 'blocked: ' || sqlerrm); end $$;
-- a value must equal the expected one
create function public.t_eq(l text, q text, want text) returns void language plpgsql as $$
declare got text;
begin execute q into got;
  perform public.t_rec(l, got is not distinct from want, 'got=' || coalesce(got,'NULL') || ' want=' || coalesce(want,'NULL'));
exception when others then perform public.t_rec(l, false, sqlerrm); end $$;
grant execute on all functions in schema public to authenticated;

-- ===== 1. users =====
insert into auth.users(id,email,raw_user_meta_data) values
 (gen_random_uuid(),'mohamed@t','{"full_name":"محمد (أدمن)"}');
insert into auth.users(id,email,raw_user_meta_data) select gen_random_uuid(), e, jsonb_build_object('full_name', n) from (values
 ('owner@t','صاحب الشركة'),('gm@t','المدير العام'),('head@t','رئيس قسم المقاولات'),('head2@t','رئيس قسم المعماري'),
 ('site@t','مهندس الموقع'),('proc@t','موظف المشتريات'),('qs@t','مهندس الكميات'),('fin@t','المحاسب'),('new@t','موظف جديد')) v(e,n);
insert into public.t_users select split_part(email,'@',1), id from auth.users;
update public.t_users set name = 'admin' where name = 'mohamed';

set role authenticated;
select public.t_s('1 المستخدمين');
select public.t_as('admin');
select public.t_eq('أول حساب يصير مدير النظام', $$select role from public.profiles where id = public.t_id('admin')$$, 'admin');
select public.t_eq('الحسابات بعده بانتظار التفعيل', $$select count(*)::text from public.profiles where role = 'pending'$$, '9');
select public.t_ok('الأدمن يحدد دور صاحب الشركة', $$select public.set_user_role(public.t_id('owner'),'owner',null)$$);
select public.t_ok('الأدمن يحدد دور المدير العام', $$select public.set_user_role(public.t_id('gm'),'gm',null)$$);
select public.t_ok('الأدمن يحدد رئيس قسم', $$select public.set_user_role(public.t_id('head'),'head',null)$$);
select public.t_ok('الأدمن يعطي رئيس القسم قسمين (مقاولات + فيت أوت)', $$select public.set_user_depts(public.t_id('head'), array['contracting','fitout'])$$);
select public.t_ok('الأدمن يحدد رئيس قسم المعماري', $$select public.set_user_role(public.t_id('head2'),'head',null)$$);
select public.t_ok('قسم المعماري لرئيسه', $$select public.set_user_depts(public.t_id('head2'), array['arch'])$$);
select public.t_ok('الأدمن يحدد مهندس الموقع', $$select public.set_user_role(public.t_id('site'),'site',null)$$);
select public.t_ok('قسم مهندس الموقع', $$select public.set_user_depts(public.t_id('site'), array['contracting'])$$);
select public.t_ok('الأدمن يحدد المشتريات', $$select public.set_user_role(public.t_id('proc'),'procurement',null)$$);
select public.t_ok('الأدمن يحدد مهندس الكميات QS', $$select public.set_user_role(public.t_id('qs'),'qs',null)$$);
select public.t_ok('الأدمن يحدد المالية', $$select public.set_user_role(public.t_id('fin'),'finance',null)$$);
select public.t_no('قسم غير معروف مرفوض', $$select public.set_user_depts(public.t_id('site'), array['xyz'])$$);
select public.t_as('gm');
select public.t_no('المدير العام ما يقدر يغير أدوار المستخدمين', $$select public.set_user_role(public.t_id('new'),'gm',null)$$);
select public.t_no('المدير العام ما يقدر يحذف مستخدم', $$delete from public.profiles where id = public.t_id('new')$$);
select public.t_as('new');
select public.t_no('موظف غير مفعّل ما يقدر يسوي طلب', $$insert into public.petty_cash(project_id,amount,description,requested_by) select id,1,'x',public.t_id('new') from public.projects limit 1$$);

-- ===== 2. project =====
select public.t_s('2 المشروع');
select public.t_as('site');
select public.t_no('مهندس الموقع ما يقدر ينشئ مشروع', $$insert into public.projects(name,short_name,type,start_date,end_date,approval,requested_by) values ('x','x','gov','2026-11-01','2027-03-01','pending',public.t_id('site'))$$);
select public.t_as('head');
select public.t_ok('رئيس القسم يقترح مشروع (ينتظر الاعتماد)', $$insert into public.projects(name,short_name,client,type,client_type,client_phone,client_id_no,client_id_path,start_date,end_date,approval,requested_by,depts,governorate,wilayat)
  values ('فيلا تجريبية','فيلا','عميل تجريبي','private','individual','99999999','12345678','clients/id.pdf','2026-11-01','2027-03-01','pending',public.t_id('head'),'{contracting,fitout,arch}','مسقط','بوشر')$$);
select public.t_no('رئيس القسم ما يقدر يعتمد مشروعه بنفسه', $$update public.projects set approval='approved' where name='فيلا تجريبية'$$);
select public.t_ok('رئيس القسم يضيف أقسام الـ BOQ', $$insert into public.boq_sections(project_id,code,name,sort) select id,'1','الأعمال الإنشائية',0 from public.projects where name='فيلا تجريبية'$$);
select public.t_ok('رئيس القسم يضيف بنود الـ BOQ', $$insert into public.boq_items(project_id,section_code,code,description,qty,unit,rate,total,dept,sort)
  select id,'1',c,d,q,'m3',r,q*r,dp,s from public.projects, (values ('1.1','خرسانة القواعد',100,50,'contracting',0),('1.2','تشطيب داخلي',200,30,'fitout',1),('1.3','مخططات معمارية',1,4000,'arch',2)) v(c,d,q,r,dp,s) where name='فيلا تجريبية'$$);
select public.t_no('رئيس القسم ما يقدر يعدل مشروع غيره', $$update public.projects set name='x' where name<>'فيلا تجريبية'$$);
select public.t_as('gm');
select public.t_ok('المدير العام يعتمد المشروع', $$select public.decide_project((select id from public.projects where name='فيلا تجريبية'), true, 'تمام')$$);
select public.t_eq('المشروع صار معتمد', $$select approval from public.projects where name='فيلا تجريبية'$$, 'approved');
select public.t_eq('كود المشروع بالترقيم الجديد', $$select (code ~ '^CEC-PRJ-[0-9]{4}-[0-9]{3}$')::text from public.projects where name='فيلا تجريبية'$$, 'true');
select public.t_no('كود المشروع ما يتغير', $$update public.projects set code='X' where name='فيلا تجريبية'$$);
select public.t_as('head');
select public.t_no('رئيس القسم ما يضيف بنود بعد الاعتماد', $$insert into public.boq_items(project_id,section_code,code,description) select id,'1','1.9','x' from public.projects where name='فيلا تجريبية'$$);
select public.t_ok('رئيس القسم يحدد مدة بند من قسمه', $$select public.set_item_dates(jsonb_build_array(jsonb_build_object('id',(select b.id from public.boq_items b join public.projects p on p.id=b.project_id where p.name='فيلا تجريبية' and b.code='1.1'),'start','2026-11-05','end','2026-11-25')))$$);
select public.t_no('رئيس القسم ما يحدد مدة بند من قسم ثاني', $$select public.set_item_dates(jsonb_build_array(jsonb_build_object('id',(select b.id from public.boq_items b join public.projects p on p.id=b.project_id where p.name='فيلا تجريبية' and b.code='1.3'),'start','2026-11-05','end','2026-11-25')))$$);
select public.t_no('تاريخ النهاية قبل البداية مرفوض', $$select public.set_item_dates(jsonb_build_array(jsonb_build_object('id',(select b.id from public.boq_items b join public.projects p on p.id=b.project_id where p.name='فيلا تجريبية' and b.code='1.1'),'start','2026-11-25','end','2026-11-05')))$$);
select public.t_no('رئيس القسم ما يغير الأسعار', $$select public.set_item_prices(jsonb_build_array(jsonb_build_object('id',(select b.id from public.boq_items b join public.projects p on p.id=b.project_id where p.name='فيلا تجريبية' and b.code='1.1'),'qty',1,'rate',1)))$$);
select public.t_no('رئيس القسم ما يغير قسم البند', $$select public.set_item_depts(jsonb_build_array(jsonb_build_object('id',(select b.id from public.boq_items b join public.projects p on p.id=b.project_id where p.name='فيلا تجريبية' and b.code='1.1'),'dept','arch')))$$);
select public.t_as('site');
select public.t_ok('مهندس الموقع يحدث نسبة الإنجاز', $$select public.set_progress((select b.id from public.boq_items b join public.projects p on p.id=b.project_id where p.name='فيلا تجريبية' and b.code='1.1'), 40)$$);
select public.t_no('مهندس الموقع ما يعتمد الجدول', $$select public.approve_schedule((select id from public.projects where name='فيلا تجريبية'))$$);
select public.t_as('gm');
select public.t_ok('المدير العام يعدل الكمية والسعر', $$select public.set_item_prices(jsonb_build_array(jsonb_build_object('id',(select b.id from public.boq_items b join public.projects p on p.id=b.project_id where p.name='فيلا تجريبية' and b.code='1.2'),'qty',250,'rate',30)))$$);
select public.t_eq('الإجمالي ينحسب كمية × سعر', $$select (b.total = 7500)::text from public.boq_items b join public.projects p on p.id=b.project_id where p.name='فيلا تجريبية' and b.code='1.2'$$, 'true');
select public.t_ok('المدير العام يغير قسم البند', $$select public.set_item_depts(jsonb_build_array(jsonb_build_object('id',(select b.id from public.boq_items b join public.projects p on p.id=b.project_id where p.name='فيلا تجريبية' and b.code='1.2'),'dept','joinery')))$$);
select public.t_eq('القسم الجديد انضاف للمشروع', $$select ('joinery' = any(depts))::text from public.projects where name='فيلا تجريبية'$$, 'true');
select public.t_ok('المدير العام يعدل اسم قسم BOQ', $$select public.rename_section((select id from public.projects where name='فيلا تجريبية'),'1','أعمال الهيكل')$$);
select public.t_ok('المدير العام يعتمد الجدول الزمني', $$select public.approve_schedule((select id from public.projects where name='فيلا تجريبية'),'معتمد')$$);
select public.t_ok('المدير العام يغير حالة المشروع لمنجز', $$update public.projects set status='done' where name='فيلا تجريبية'$$);
select public.t_ok('ويرجعه جاري', $$update public.projects set status='active' where name='فيلا تجريبية'$$);

-- ===== 3. material request: full path =====
select public.t_s('3 طلب المواد (المسار الكامل)');
select public.t_as('site');
select public.t_ok('مهندس الموقع يسوي طلب مواد', $$insert into public.material_requests(project_id,boq_item_id,dept,requested_by,need_by,note) select p.id,b.id,'contracting',public.t_id('site'),'2026-11-20','للقواعد' from public.projects p join public.boq_items b on b.project_id=p.id and b.code='1.1' where p.name='فيلا تجريبية'$$);
select public.t_ok('ويضيف المواد', $$insert into public.request_items(request_id,description,qty) select id,d,q from public.material_requests, (values ('اسمنت',50),('حديد 16مم',2)) v(d,q) where note='للقواعد'$$);
select public.t_eq('رقم الطلب بالترقيم الجديد', $$select (no ~ '^CEC-MR-')::text from public.material_requests where note='للقواعد'$$, 'true');
select public.t_no('مهندس الموقع ما يقدر يعتمد طلبه', $$select public.advance_request((select id from public.material_requests where note='للقواعد'))$$);
select public.t_no('مهندس الموقع ما يقدر يغير مرحلة الطلب مباشرة', $$update public.material_requests set stage='po' where note='للقواعد'$$);
select public.t_as('head2');
select public.t_no('رئيس قسم ثاني (معماري) ما يعتمد طلب المقاولات', $$select public.advance_request((select id from public.material_requests where note='للقواعد'))$$);
select public.t_as('head');
select public.t_ok('رئيس قسم المقاولات يعتمد', $$select public.advance_request((select id from public.material_requests where note='للقواعد'),'تمام')$$);
select public.t_eq('الطلب عند المشتريات', $$select stage from public.material_requests where note='للقواعد'$$, 'procurement');
select public.t_as('site');
select public.t_eq('مهندس الموقع ما يشوف قائمة الموردين', $$select count(*)::text from public.suppliers$$, '0');
select public.t_no('مهندس الموقع ما يسجل مورّد', $$insert into public.suppliers(name,cr_no,cr_path,phone) values ('x','1','a','1')$$);
select public.t_as('proc');
select public.t_ok('المشتريات يسجل مورّد مع السجل التجاري والبنك', $$insert into public.suppliers(name,cr_no,cr_path,phone,contact_name,bank_name,account_name,bank_account,iban) values ('مؤسسة البناء الحديث','1234567','suppliers/cr.pdf','+96891234567','سالم','بنك مسقط','مؤسسة البناء','0123456789','OM120270000000000000000')$$);
select public.t_no('المورّد بدون سجل تجاري مرفوض', $$insert into public.suppliers(name,phone) values ('بدون سجل','1')$$);
select public.t_ok('المشتريات يكتب سعر كل مادة', $$select public.set_request_items((select id from public.material_requests where note='للقواعد'), (select jsonb_agg(jsonb_build_object('id',id,'d',description,'price',case when description='اسمنت' then '2.1' else '250' end)) from public.request_items where request_id=(select id from public.material_requests where note='للقواعد')))$$);
select public.t_ok('المشتريات يسجل عرض المورّد (بدون ملف وبدون مورّد مسجل)', $$insert into public.quotes(request_id,supplier,amount,terms,delivery_days,selected) select id,'مؤسسة البناء الحديث',605,'credit30',3,true from public.material_requests where note='للقواعد'$$);
select public.t_no('ما يقدر يرسل بدون ملف الكوتيشن', $$select public.advance_request((select id from public.material_requests where note='للقواعد'))$$);
select public.t_ok('يرفق ملف الكوتيشن', $$update public.quotes set file_path='quotes/q1.pdf' where request_id=(select id from public.material_requests where note='للقواعد')$$);
select public.t_no('ما يقدر يرسل بدون اختيار مورّد من القائمة', $$select public.advance_request((select id from public.material_requests where note='للقواعد'))$$);
select public.t_ok('يختار المورّد من القائمة', $$update public.quotes set supplier_id=(select id from public.suppliers limit 1) where request_id=(select id from public.material_requests where note='للقواعد')$$);
select public.t_ok('المشتريات يرسل لمهندس الكميات', $$select public.advance_request((select id from public.material_requests where note='للقواعد'))$$);
select public.t_eq('الطلب عند QS', $$select stage from public.material_requests where note='للقواعد'$$, 'qs');
select public.t_no('المشتريات ما يعدل الكوتيشن بعد الإرسال', $$update public.quotes set amount=1 where request_id=(select id from public.material_requests where note='للقواعد')$$);
select public.t_as('gm');
select public.t_no('المدير العام ما يقدر يتخطى QS', $$select public.advance_request((select id from public.material_requests where note='للقواعد'))$$);
select public.t_as('qs');
select public.t_eq('QS يشوف قائمة الموردين', $$select count(*)::text from public.suppliers$$, '1');
select public.t_no('QS ما يعدل بيانات المورّد', $$update public.suppliers set phone='0'$$);
select public.t_no('طلب توضيح بدون كتابة السؤال مرفوض', $$select public.clarify_request((select id from public.material_requests where note='للقواعد'),'procurement','')$$);
select public.t_ok('QS يرجع الطلب للمشتريات للتوضيح', $$select public.clarify_request((select id from public.material_requests where note='للقواعد'),'procurement','سعر الحديد أعلى من السوق؟')$$);
select public.t_as('proc');
select public.t_no('رد المشتريات بدون كتابة التوضيح مرفوض', $$select public.advance_request((select id from public.material_requests where note='للقواعد'))$$);
select public.t_ok('المشتريات يرد على QS', $$select public.advance_request((select id from public.material_requests where note='للقواعد'),'هذا أقل سعر من 3 موردين')$$);
select public.t_eq('الرد يرجع لـ QS مباشرة', $$select stage from public.material_requests where note='للقواعد'$$, 'qs');
select public.t_as('qs');
select public.t_ok('QS يوافق ويرسل للمدير العام', $$select public.advance_request((select id from public.material_requests where note='للقواعد'),'مطابق للـ BOQ')$$);
select public.t_as('gm');
select public.t_ok('المدير العام يطلب توضيح من رئيس القسم', $$select public.clarify_request((select id from public.material_requests where note='للقواعد'),'dept','ليش 50 كيس؟')$$);
select public.t_as('head');
select public.t_ok('رئيس القسم يرد', $$select public.advance_request((select id from public.material_requests where note='للقواعد'),'حسب كمية القواعد')$$);
select public.t_eq('الرد يرجع للمدير العام مباشرة', $$select stage from public.material_requests where note='للقواعد'$$, 'gm');
select public.t_as('gm');
select public.t_ok('المدير العام يطلب توضيح من QS', $$select public.clarify_request((select id from public.material_requests where note='للقواعد'),'qs','متأكد من الكمية؟')$$);
select public.t_as('qs');
select public.t_ok('QS يرد على المدير العام', $$select public.advance_request((select id from public.material_requests where note='للقواعد'),'نعم')$$);
select public.t_as('gm');
select public.t_ok('المدير العام يعتمد الشراء', $$select public.advance_request((select id from public.material_requests where note='للقواعد'))$$);
select public.t_as('qs');
select public.t_no('QS ما يصدر أمر الشراء', $$select public.advance_request((select id from public.material_requests where note='للقواعد'))$$);
select public.t_as('proc');
select public.t_ok('المشتريات يصدر أمر الشراء', $$select public.advance_request((select id from public.material_requests where note='للقواعد'))$$);
select public.t_eq('رقم أمر الشراء بالترقيم الجديد', $$select (po_no ~ '^CEC-PO-')::text from public.material_requests where note='للقواعد'$$, 'true');
select public.t_eq('سجل الإجراءات كامل (12 خطوة)', $$select count(*)::text from public.request_history where request_id=(select id from public.material_requests where note='للقواعد')$$, '12');

-- ===== 4. procurement's own request, rejection =====
select public.t_s('4 طلب المشتريات المباشر والرفض');
select public.t_as('proc');
select public.t_ok('المشتريات يسوي طلب بنفسه مع الأسعار', $$insert into public.material_requests(project_id,dept,requested_by,note) select id,'contracting',public.t_id('proc'),'طلب مشتريات' from public.projects where name='فيلا تجريبية'$$);
select public.t_ok('المواد مع السعر', $$insert into public.request_items(request_id,description,qty,unit_price) select id,'رمل',10,5 from public.material_requests where note='طلب مشتريات'$$);
select public.t_ok('يبدأ من خطوة التسعير مباشرة', $$select public.start_proc_request((select id from public.material_requests where note='طلب مشتريات'))$$);
select public.t_ok('يسجل العرض مع الكوتيشن والمورّد', $$insert into public.quotes(request_id,supplier,supplier_id,amount,terms,selected,file_path) select r.id,s.name,s.id,50,'advance',true,'quotes/q2.pdf' from public.material_requests r, public.suppliers s where r.note='طلب مشتريات'$$);
select public.t_ok('يرسل لـ QS', $$select public.advance_request((select id from public.material_requests where note='طلب مشتريات'))$$);
select public.t_eq('الطلب عند QS', $$select stage from public.material_requests where note='طلب مشتريات'$$, 'qs');
select public.t_as('site');
select public.t_ok('مهندس الموقع يسوي طلب ثاني', $$insert into public.material_requests(project_id,dept,requested_by,note) select id,'contracting',public.t_id('site'),'طلب للرفض' from public.projects where name='فيلا تجريبية'$$);
select public.t_no('مهندس الموقع ما يقدر يتخطى رئيس القسم', $$select public.start_proc_request((select id from public.material_requests where note='طلب للرفض'))$$);
select public.t_as('head');
select public.t_no('الرفض بدون سبب مرفوض', $$select public.reject_request((select id from public.material_requests where note='طلب للرفض'),'')$$);
select public.t_ok('رئيس القسم يرفض مع السبب', $$select public.reject_request((select id from public.material_requests where note='طلب للرفض'),'مو محتاجين')$$);
select public.t_eq('الطلب مرفوض', $$select stage from public.material_requests where note='طلب للرفض'$$, 'rejected');

select public.t_as('qs');
select public.t_ok('QS يوافق على طلب المشتريات', $$select public.advance_request((select id from public.material_requests where note='طلب مشتريات'))$$);
select public.t_as('owner');
select public.t_ok('صاحب الشركة يعتمد الشراء مكان المدير العام', $$select public.advance_request((select id from public.material_requests where note='طلب مشتريات'))$$);
select public.t_eq('الطلب صار عند المشتريات لأمر الشراء', $$select stage from public.material_requests where note='طلب مشتريات'$$, 'po');
select public.t_as('fin');
select public.t_no('المحاسب ما يعتمد الشراء', $$select public.reject_request((select id from public.material_requests where note='طلب مشتريات'),'x')$$);

-- ===== 5. petty cash, VO, documents =====
select public.t_s('5 البيتي كاش والـ VO والمستندات');
select public.t_as('site');
select public.t_ok('مهندس الموقع يطلب بيتي كاش', $$insert into public.petty_cash(project_id,amount,description,requested_by) select id,25,'مسامير ومواد بسيطة',public.t_id('site') from public.projects where name='فيلا تجريبية'$$);
select public.t_no('ما يقدر يسجله كمعتمد بنفسه', $$insert into public.petty_cash(project_id,amount,description,requested_by,status) select id,25,'x',public.t_id('site'),'approved' from public.projects where name='فيلا تجريبية'$$);
select public.t_no('مهندس الموقع ما يعتمد البيتي كاش', $$select public.decide_petty((select id from public.petty_cash where description='مسامير ومواد بسيطة'), true, null)$$);
select public.t_no('ما يرفق الفاتورة قبل الاعتماد', $$select public.attach_petty_invoice((select id from public.petty_cash where description='مسامير ومواد بسيطة'),'petty/inv.pdf')$$);
select public.t_as('gm');
select public.t_ok('المدير العام يعتمد البيتي كاش', $$select public.decide_petty((select id from public.petty_cash where description='مسامير ومواد بسيطة'), true, null)$$);
select public.t_as('proc');
select public.t_no('شخص غير صاحب الطلب ما يرفق فاتورته', $$select public.attach_petty_invoice((select id from public.petty_cash where description='مسامير ومواد بسيطة'),'petty/inv.pdf')$$);
select public.t_as('site');
select public.t_ok('صاحب الطلب يرفق الفاتورة', $$select public.attach_petty_invoice((select id from public.petty_cash where description='مسامير ومواد بسيطة'),'petty/inv.pdf')$$);
select public.t_ok('مهندس الموقع يسجل Variation Order مع موافقة العميل', $$insert into public.variations(project_id,title,description,amount,approval_path,client_status,created_by) select id,'غرفة إضافية','بناء غرفة تخزين',3500,'variations/ok.pdf','approved',public.t_id('site') from public.projects where name='فيلا تجريبية'$$);
select public.t_no('صاحب الـ VO ما يعتمده بنفسه', $$update public.variations set gm_status='approved' where title='غرفة إضافية'$$);
select public.t_ok('يرفع مستند للمشروع', $$insert into public.project_docs(project_id,kind,title,path,uploaded_by) select id,'contract','العقد','docs/c.pdf',public.t_id('site') from public.projects where name='فيلا تجريبية'$$);
select public.t_no('ما يحذف المستند', $$delete from public.project_docs where title='العقد'$$);
select public.t_as('gm');
select public.t_ok('المدير العام يعتمد الـ VO', $$select public.decide_variation((select id from public.variations where title='غرفة إضافية'), true, null)$$);
select public.t_eq('قيمة العقد الأصلية ما تغيرت بعد الـ VO', $$select (sum(total) = 16500)::text from public.boq_items b join public.projects p on p.id=b.project_id where p.name='فيلا تجريبية'$$, 'true');

-- ===== 5b. client invoices and receipts =====
select public.t_s('5ب المبالغ المستلمة');
select public.t_as('site');
select public.t_no('مهندس الموقع ما يسجل فاتورة عميل', $$insert into public.client_invoices(project_id,invoice_no,invoice_date,amount,created_by) select id,'X','2026-11-10',1,public.t_id('site') from public.projects where name='فيلا تجريبية'$$);
select public.t_as('fin');
select public.t_ok('المالية تسجل فاتورة للعميل (دفعة 1)', $$insert into public.client_invoices(project_id,invoice_no,invoice_date,amount,work_desc,work_pct,created_by) select id,'INV-001','2026-11-10',5000,'أعمال الهيكل',30,public.t_id('fin') from public.projects where name='فيلا تجريبية'$$);
select public.t_no('رقم الفاتورة ما يتكرر في نفس المشروع', $$insert into public.client_invoices(project_id,invoice_no,invoice_date,amount,created_by) select id,'INV-001','2026-11-11',1,public.t_id('fin') from public.projects where name='فيلا تجريبية'$$);
select public.t_ok('المالية تسجل مبلغ مستلم مقابل الفاتورة', $$insert into public.client_payments(project_id,invoice_id,amount,received_on,method,reference,created_by) select p.id,i.id,3000,'2026-11-14','transfer','TRX-1',public.t_id('fin') from public.projects p join public.client_invoices i on i.project_id=p.id where p.name='فيلا تجريبية'$$);
select public.t_no('ما يربط المبلغ بفاتورة مشروع ثاني', $$insert into public.client_payments(project_id,invoice_id,amount,received_on,created_by) select p.id,(select id from public.client_invoices limit 1),1,'2026-11-14',public.t_id('fin') from public.projects p where p.name<>'فيلا تجريبية' limit 1$$);
select public.t_as('owner');
select public.t_eq('صاحب الشركة يشوف المستلم', $$select sum(amount)::int::text from public.client_payments$$, '3000');
select public.t_eq('ويشوف رقم الفاتورة', $$select i.invoice_no from public.client_payments c join public.client_invoices i on i.id=c.invoice_id$$, 'INV-001');
select public.t_no('صاحب الشركة ما يعدل المبالغ (للمالية)', $$update public.client_payments set amount=1$$);
select public.t_as('head');
select public.t_eq('رئيس القسم ما يشوف المبالغ المستلمة', $$select count(*)::text from public.client_payments$$, '0');
select public.t_as('fin');
select public.t_no('المالية ما تحذف (الحذف للأدمن)', $$delete from public.client_payments$$);

-- ===== 6. finance, audit log, admin =====
select public.t_s('6 المالية والسجل والأدمن');
select public.t_as('fin');
select public.t_eq('المحاسب يشوف البيتي كاش', $$select count(*)::text from public.petty_cash$$, '1');
select public.t_eq('المحاسب يشوف الموردين', $$select count(*)::text from public.suppliers$$, '1');
select public.t_no('المحاسب ما يعدل المورّد', $$update public.suppliers set phone='0'$$);
select public.t_no('المحاسب ما يصدر أمر الشراء', $$select public.advance_request((select id from public.material_requests where note='طلب مشتريات'))$$);
select public.t_as('gm');
select public.t_eq('المدير العام ما يشوف سجل النشاط', $$select count(*)::text from public.audit_log$$, '0');
select public.t_no('المدير العام ما يحذف بيتي كاش', $$delete from public.petty_cash$$);
select public.t_no('المدير العام ما يحذف مشروع', $$delete from public.projects$$);
select public.t_as('admin');
select public.t_eq('الأدمن يشوف سجل النشاط', $$select (count(*) > 20)::text from public.audit_log$$, 'true');
select public.t_eq('السجل يحفظ القيمة القديمة والجديدة للتعديل', $$select (changes ? 'total')::text from public.audit_log where table_name='boq_items' and action='update' and record_label like '1.2%' order by id limit 1$$, 'true');
select public.t_no('حتى الأدمن ما يعدل سجل النشاط', $$update public.audit_log set user_name='x'$$);
select public.t_no('حتى الأدمن ما يحذف سجل النشاط', $$delete from public.audit_log$$);
select public.t_ok('الأدمن يسجل دخول في السجل', $$select public.log_event('login','Muscat','OM')$$);
select public.t_ok('الأدمن يحذف البيتي كاش', $$delete from public.petty_cash$$);
select public.t_ok('الأدمن يحذف طلب مواد (مع مواده وعروضه)', $$delete from public.material_requests where note='طلب للرفض'$$);
select public.t_ok('الأدمن يحذف مورّد غير مستخدم', $$insert into public.suppliers(name,cr_no,cr_path,phone) values ('مؤقت','9','a','1'); delete from public.suppliers where name='مؤقت'$$);
select public.t_ok('الأدمن يحذف المشروع كامل', $$delete from public.projects where name='فيلا تجريبية'$$);
select public.t_eq('حذف المشروع يحذف طلباته', $$select count(*)::text from public.material_requests$$, '0');

reset role;
\pset footer off
select sec as "القسم", count(*) filter (where ok) as "نجح", count(*) filter (where not ok) as "فشل" from public.t_res group by sec order by sec;
select n, sec, label, detail from public.t_res where not ok order by n;
\copy (select n, sec, label, ok, detail from public.t_res order by n) to '/var/tmp/pgt/e2e_results.csv' csv header
