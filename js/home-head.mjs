// imorchy.dev v3 homepage, run blocking in <head>: the motion styles key off .js, so it's set before first paint,
// and only when the visitor hasn't asked for reduced motion.
if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('js');
