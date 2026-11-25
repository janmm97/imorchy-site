(()=>{
const S={"Operations":{"ask":"Reply to today’s 6 patient enquiries","apps":{"gmail":"Full","google-calendar":"Read"},"cap":"Operations reads the inbox, checks your calendar for free slots and drafts 6 replies.","gate":"Send 6 replies from Gmail?","log":[["GMAIL · READ","ALLOWED"],["CALENDAR · READ","ALLOWED"],["GMAIL · SEND","WAITING FOR YOU"]],"ok":"SENT · YOU APPROVED"},"Marketing":{"ask":"Draft next week’s posts from the content calendar","apps":{"notion":"Read","slack":"Full"},"cap":"Marketing reads the Notion content calendar and drafts 3 posts in your voice.","gate":"Share 3 drafts in Slack #marketing?","log":[["NOTION · READ","ALLOWED"],["NOTION · DRAFT","ALLOWED"],["SLACK · POST","WAITING FOR YOU"]],"ok":"POSTED · YOU APPROVED"},"Finance":{"ask":"Chase the 2 unpaid invoices","apps":{"stripe":"Read","gmail":"Full"},"cap":"Finance finds 2 unpaid invoices in Stripe and drafts a friendly reminder for each.","gate":"Send 2 reminders from Gmail?","log":[["STRIPE · READ","ALLOWED"],["GMAIL · DRAFT","ALLOWED"],["GMAIL · SEND","WAITING FOR YOU"]],"ok":"SENT · YOU APPROVED"},"IT":{"ask":"Triage this week’s new GitHub issues","apps":{"github":"Read","slack":"Full"},"cap":"IT reads the new issues, sorts them by urgency and writes a short summary.","gate":"Post the summary in Slack #dev?","log":[["GITHUB · READ","ALLOWED"],["SUMMARY · DRAFT","ALLOWED"],["SLACK · POST","WAITING FOR YOU"]],"ok":"POSTED · YOU APPROVED"},"Sales":{"ask":"Book follow-ups with this week’s leads","apps":{"gmail":"Read","google-calendar":"Full"},"cap":"Sales reads the lead replies and finds 3 open slots that suit both sides.","gate":"Add 3 invites to your calendar?","log":[["GMAIL · READ","ALLOWED"],["CALENDAR · READ","ALLOWED"],["CALENDAR · INVITE","WAITING FOR YOU"]],"ok":"ADDED · YOU APPROVED"}},O=["Operations","Marketing","Finance","IT","Sales"];
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
/* header: dropdowns, mobile sheet, scrolled surface */
const gn=document.querySelector('.gnav'),dds=[...document.querySelectorAll('.dd>.nl')],bg=document.querySelector('.gburger'),sh=document.getElementById('gsheet');
const closeAll=x=>dds.forEach(b=>{if(b!==x)b.setAttribute('aria-expanded','false')});
dds.forEach(b=>{const li=b.parentElement;let t;
 b.addEventListener('click',()=>{const o=b.getAttribute('aria-expanded')!=='true';closeAll(b);b.setAttribute('aria-expanded',String(o))});
 if(matchMedia('(hover:hover)').matches){li.addEventListener('mouseenter',()=>{clearTimeout(t);closeAll(b);b.setAttribute('aria-expanded','true')});li.addEventListener('mouseleave',()=>{t=setTimeout(()=>b.setAttribute('aria-expanded','false'),160)})}
 li.addEventListener('focusout',e=>{if(!li.contains(e.relatedTarget))b.setAttribute('aria-expanded','false')})});
const setSheet=o=>{bg.setAttribute('aria-expanded',String(o));bg.setAttribute('aria-label',o?'Close menu':'Open menu');sh.hidden=!o};
bg.addEventListener('click',()=>setSheet(sh.hidden));
sh.addEventListener('click',e=>{if(e.target.closest('a'))setSheet(false)});
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;const open=dds.find(b=>b.getAttribute('aria-expanded')==='true');if(open){open.setAttribute('aria-expanded','false');open.focus()}if(!sh.hidden){setSheet(false);bg.focus()}});
document.addEventListener('click',e=>{if(!e.target.closest('.dd'))closeAll()});
const f=()=>gn.classList.toggle('scrolled',scrollY>8);f();addEventListener('scroll',f,{passive:true});
/* demo */
const d=document.getElementById('demo');if(!d)return;
const ags=[...d.querySelectorAll('.ag')],apps=[...d.querySelectorAll('.apps5 li')],w1=d.querySelector('.w1'),w2=d.querySelector('.w2'),hub=d.querySelector('.hub'),askT=d.querySelector('#ask-t'),cap=d.querySelector('#cap'),gate=d.querySelector('.gate'),gq=d.querySelector('#gate-q'),logs=[...d.querySelectorAll('.log li')],pb=d.querySelector('.dpause'),bOk=d.querySelector('.gbtn.ok'),bNo=d.querySelector('.gbtn.deny');
let cur=d.dataset.start||'Operations',auto=!reduce,paused=reduce,timers=[],ready=false;
const NS='http://www.w3.org/2000/svg';
const ctr=el=>{const r=el.getBoundingClientRect(),b=d.getBoundingClientRect();return r.left-b.left+r.width/2};
function draw(){
 const wd=w1.getBoundingClientRect().width,base=w1.getBoundingClientRect().left-d.getBoundingClientRect().left,hx=ctr(hub)-base,s=S[cur];
 const h1=40,h2=48;w1.setAttribute('viewBox','0 0 '+wd+' '+h1);w2.setAttribute('viewBox','0 0 '+wd+' '+h2);
 w1.innerHTML=ags.map(a=>{const x=ctr(a)-base,on=a.dataset.a===cur;return '<path class="'+(on&&ready?'on':'')+'" d="M'+x+' 0 C'+x+' '+h1*.6+' '+hx+' '+h1*.4+' '+hx+' '+h1+'"/>'}).join('');
 w2.innerHTML=apps.map(li=>{const x=ctr(li)-base,on=ready&&s.apps[li.dataset.app];return '<path class="'+(on?'on':'')+'" d="M'+hx+' 0 C'+hx+' '+h2*.6+' '+x+' '+h2*.4+' '+x+' '+h2+'"/>'}).join('');
 if(!reduce&&ready){[w1,w2].forEach(w=>w.querySelectorAll('path.on').forEach((p,i)=>{const c=document.createElementNS(NS,'circle');c.setAttribute('r','2.5');const m=document.createElementNS(NS,'animateMotion');m.setAttribute('dur','1.4s');m.setAttribute('repeatCount','indefinite');m.setAttribute('begin',(i*.35)+'s');m.setAttribute('path',p.getAttribute('d'));c.appendChild(m);w.appendChild(c)}));if(paused){w1.pauseAnimations();w2.pauseAnimations()}}
}
const T=(fn,ms)=>timers.push(setTimeout(fn,ms));
const clear=()=>{timers.forEach(clearTimeout);timers=[]};
function setLog(i,cls,v){const li=logs[i];li.className=cls;li.querySelector('b').textContent=v}
function play(a,fromUser){
 clear();cur=a;const s=S[a];ready=false;
 ags.forEach(b=>{const on=b.dataset.a===a;b.setAttribute('aria-checked',String(on));b.tabIndex=on?0:-1});
 apps.forEach(li=>{li.classList.remove('on');li.querySelector('.acc').textContent='—';li.querySelector('.acc').className='acc'});
 gate.classList.add('off');gate.inert=true;bOk.classList.remove('hit');bNo.classList.remove('hit');
 logs.forEach((li,i)=>{li.querySelector('span').textContent=a.toUpperCase()+' · '+s.log[i][0];setLog(i,'hide '+(i===2?'wait':'yes'),s.log[i][1])});
 cap.textContent='Orchy hands the task to the '+a+' agent…';gq.textContent=s.gate;
 const fin=()=>{ready=true;apps.forEach(li=>{const v=s.apps[li.dataset.app];if(v){li.classList.add('on');const c=li.querySelector('.acc');c.textContent=v;c.className='acc'+(v==='Read'?' read':'')}});draw();logs.forEach((li,i)=>li.classList.remove('hide'));cap.textContent=s.cap;gate.classList.remove('off');gate.inert=false};
 if(reduce||paused){askT.textContent=s.ask;fin();return}
 askT.textContent='';let n=0;const ty=()=>{askT.textContent=s.ask.slice(0,++n);if(n<s.ask.length)T(ty,28)};ty();
 const tt=s.ask.length*28;
 T(()=>{ready=true;draw();ready=false;w2.innerHTML=w2.innerHTML.replace(/class="on"/g,'class=""');hub.classList.remove('pulse');void hub.offsetWidth;hub.classList.add('pulse')},tt+200);
 T(()=>{fin();logs.forEach(li=>li.classList.add('hide'));T(()=>logs[0].classList.remove('hide'),150);T(()=>logs[1].classList.remove('hide'),600);T(()=>logs[2].classList.remove('hide'),1100)},tt+900);
 if(auto&&!fromUser){T(()=>{bOk.classList.add('hit');decide(true,false)},tt+4800);T(()=>next(),tt+7000)}
}
function decide(ok,user){const s=S[cur];setLog(2,ok?'done':'no',ok?s.ok:'DENIED · NOTHING WENT OUT');cap.textContent=ok?'Approved. The '+cur+' agent did it, and the task is marked done.':'Denied. Nothing went out, and the draft stays for you to edit.';gate.classList.add('off');gate.inert=true;if(user)stopAuto()}
function next(){play(O[(O.indexOf(cur)+1)%O.length])}
function stopAuto(){auto=false;cap.setAttribute('aria-live','polite')}
bOk.addEventListener('click',()=>{clear();decide(true,true)});bNo.addEventListener('click',()=>{clear();decide(false,true)});
ags.forEach((b,i)=>{b.addEventListener('click',()=>{stopAuto();play(b.dataset.a,true)});b.addEventListener('keydown',e=>{const k={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[e.key];if(!k)return;e.preventDefault();const n=ags[(i+k+ags.length)%ags.length];n.focus();n.click()})});
pb.addEventListener('click',()=>{paused=!paused;pb.setAttribute('aria-pressed',String(paused));pb.setAttribute('aria-label',paused?'Play demo':'Pause demo');d.classList.toggle('paused',paused);if(paused){clear();w1.pauseAnimations();w2.pauseAnimations();play(cur,true)}else{w1.unpauseAnimations();w2.unpauseAnimations();auto=true;play(cur)}});
if(reduce){pb.setAttribute('aria-pressed','true');pb.setAttribute('aria-label','Play demo')}
addEventListener('resize',()=>draw());
let started=false;const go=()=>{if(started)return;started=true;play(cur)};
if('IntersectionObserver' in window){const io=new IntersectionObserver(es=>{if(es[0].isIntersecting){go();io.disconnect()}});io.observe(d)}else go();
draw();
})();
