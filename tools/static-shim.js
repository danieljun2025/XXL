'use strict';
// 纯前端版本的"假后端"：在浏览器内实现 /api/*，数据存在 localStorage。
// 依赖构建时注入的 QUESTIONS、ANCHORS、ANCHOR_ORDER、shuffleIds、score。
const CFG = { top3Bonus: true, pageSize: 10 };
const DB_KEY='ca_preview_db_v1';
let mem={users:{},nextId:1};
const load=()=>{try{const s=localStorage.getItem(DB_KEY);if(s)return JSON.parse(s)}catch(e){}return mem};
const save=(d)=>{mem=d;try{localStorage.setItem(DB_KEY,JSON.stringify(d))}catch(e){}};
const qById=new Map(QUESTIONS.map(q=>[q.id,q]));
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const summary=(a)=>({id:a.id,status:a.status,startedAt:a.startedAt,submittedAt:a.submittedAt,primary:a.primary||null});
const reportNo=(a)=>'CA-'+new Date(a.submittedAt||a.startedAt).toISOString().slice(0,10).replace(/-/g,'')+'-'+String(a.id).padStart(6,'0');
function view(a,u){
  const v={id:a.id,status:a.status,name:u.name,reportNo:reportNo(a),config:CFG};
  if(a.status==='draft'){v.questions=a.order.map(id=>({id,text:qById.get(id).text}));v.answers=a.answers}
  else{v.submittedAt=a.submittedAt;v.scores=a.scores;v.primary=a.primary;v.ranking=ANCHOR_ORDER.slice().sort((x,y)=>a.scores[y]-a.scores[x]||ANCHOR_ORDER.indexOf(x)-ANCHOR_ORDER.indexOf(y))}
  return v;
}
async function handle(method,path,headers,body){
  if(path==='/api/config')return reply(200,{...CFG,anchors:ANCHORS,order:ANCHOR_ORDER});
  const db=load();
  if(path==='/api/enter'){
    const name=String(body.name||'').trim();
    if(!name||name.length>30)return reply(400,{error:'请输入姓名（1–30 个字）'});
    const norm=name.toLowerCase();let u=db.users[norm],isNew=!u;
    if(!u)u=db.users[norm]={name,attempts:[]};
    save(db);
    return reply(200,{token:'demo:'+norm,isNew,name:u.name,attempts:u.attempts.slice().reverse().map(summary)});
  }
  const tk=/^Bearer demo:(.+)$/.exec(headers.Authorization||'');
  const u=tk&&db.users[tk[1]];
  if(!u)return reply(401,{error:'请先验证身份'});
  if(path==='/api/logout')return reply(200,{ok:true});
  if(path==='/api/me')return reply(200,{name:u.name,attempts:u.attempts.slice().reverse().map(summary)});
  if(method==='POST'&&path==='/api/attempts'){
    let a=u.attempts.find(x=>x.status==='draft');
    if(!a){const seed=Math.floor(Math.random()*2147483646)+1;a={id:db.nextId++,status:'draft',seed,order:shuffleIds(QUESTIONS.map(q=>q.id),seed),answers:{},startedAt:Date.now()};u.attempts.push(a);save(db)}
    return reply(200,view(a,u));
  }
  const m=/^\/api\/attempts\/(\d+)(?:\/(answers|submit))?$/.exec(path);
  const a=m&&u.attempts.find(x=>x.id===Number(m[1]));
  if(!a)return reply(404,{error:'记录不存在'});
  if(method==='GET')return reply(200,view(a,u));
  if(a.status!=='draft')return reply(409,{error:'该测试已提交'});
  if(m[2]==='answers'){Object.assign(a.answers,body.answers||{});save(db);return reply(200,{saved:Object.keys(a.answers).length})}
  if(m[2]==='submit'){
    const picks=(body.picks||[]).map(Number);
    if(picks.length!==3)return reply(400,{error:'请选出 3 道最认同的题目'});
    let r;try{r=score(QUESTIONS,a.answers,picks)}catch(e){return reply(400,{error:e.message})}
    Object.assign(a,{status:'submitted',top3:picks,scores:r.scores,primary:r.primary,submittedAt:Date.now()});save(db);
    return reply(200,view(a,u));
  }
  return reply(404,{error:'接口不存在'});
}
const realFetch=window.fetch.bind(window);
window.fetch=(url,opts={})=>{
  if(typeof url==='string'&&url.startsWith('/api/'))return handle((opts.method||'GET').toUpperCase(),url,opts.headers||{},opts.body?JSON.parse(opts.body):{});
  return realFetch(url,opts);
};
