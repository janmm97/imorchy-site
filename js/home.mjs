// imorchy.dev v3 homepage (approved prototype, I.T. Department/Shared/site-v3): videos, use-case tabs, the rotating
// word and the scroll fallback. Loaded as a module (deferred) by index.html only.
/* ---- videos: always autoplay, muted and looped, with no pause control (Jan, 2026-11-16). They play whenever they
   are on screen and the tab is visible, reduced motion included; off-screen ones wait so the page stays light. ---- */
const frames=[...document.querySelectorAll('.vf[data-video]')],seen=new Set();
function sync(f){const v=f.querySelector('video');
 if(seen.has(f)&&!f.closest('[hidden]')&&!f.classList.contains('missing')&&!document.hidden)v.play().catch(()=>{});else v.pause()}
frames.forEach(f=>{const v=f.querySelector('video');
 v.removeAttribute('autoplay');v.autoplay=false;v.pause();   // JS takes over from the markup's autoplay
 v.addEventListener('loadeddata',()=>f.classList.add('ready'));
 if(v.readyState>=2)f.classList.add('ready');
 const srcs=v.querySelectorAll('source');srcs[srcs.length-1].addEventListener('error',()=>{f.classList.add('missing');sync(f)});
});
const io=new IntersectionObserver(es=>es.forEach(e=>{e.isIntersecting?seen.add(e.target):seen.delete(e.target);sync(e.target)}),{threshold:0});   // any visible pixel plays it, so the hero runs on load
frames.forEach(f=>io.observe(f));
document.addEventListener('visibilitychange',()=>frames.forEach(sync));
// Some browsers (iOS Low Power Mode, strict autoplay settings) refuse play() until the first touch or key: retry then.
['pointerdown','keydown'].forEach(t=>addEventListener(t,()=>frames.forEach(sync),{once:true,passive:true}));

/* ---- tabs: roving tabindex, arrows/Home/End, active tab's video plays ---- */
const tabs=document.getElementById('tabs'),tabEls=[...tabs.querySelectorAll('[role=tab]')],panelEls=tabEls.map(t=>document.getElementById(t.getAttribute('aria-controls')));
function sel(i,focus){tabEls.forEach((b,j)=>{b.setAttribute('aria-selected',i==j);b.tabIndex=i==j?0:-1});
 panelEls.forEach((p,j)=>{p.hidden=i!=j;const v=p.querySelector('video');if(i==j&&v.preload==='none')v.preload='metadata'});
 panelEls.forEach(p=>sync(p.querySelector('.vf')));   // IntersectionObserver reports the newly shown panel on its own
 if(focus)tabEls[i].focus()}
tabs.addEventListener('click',e=>{const b=e.target.closest('[role=tab]');if(b)sel(tabEls.indexOf(b))});
tabs.addEventListener('keydown',e=>{const n=tabEls.length,c=tabEls.indexOf(document.activeElement);if(c<0)return;
 const m={ArrowRight:(c+1)%n,ArrowLeft:(c+n-1)%n,Home:0,End:n-1}[e.key];if(m!==undefined){e.preventDefault();sel(m,true)}});

/* ---- rotating word (width reserved in CSS, no shift) and scroll motion still follow reduced motion ---- */
const calm=matchMedia('(prefers-reduced-motion: reduce)').matches;
const ws=[...document.querySelectorAll('#rot span')];
if(!calm){let k=0;setInterval(()=>{ws[k].classList.remove('on');k=(k+1)%ws.length;ws[k].classList.add('on')},2600)}

/* ---- r1 scroll-linked fallback for browsers without CSS scroll-driven animations ---- */
if(!calm&&!CSS.supports('animation-timeline:view()')){document.documentElement.classList.add('no-sda');
 const hv=document.querySelector('.hero .vf'),rvo=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');rvo.unobserve(e.target)}}),{rootMargin:'0px 0px -12% 0px'});
 document.querySelectorAll('.rv').forEach(x=>rvo.observe(x));
 let tk=0;addEventListener('scroll',()=>{if(tk)return;tk=requestAnimationFrame(()=>{tk=0;hv.style.setProperty('--p',Math.min(1,scrollY/(innerHeight*.6)).toFixed(3))})},{passive:true})}
