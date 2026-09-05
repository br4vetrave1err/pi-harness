document.addEventListener('DOMContentLoaded', () => {
  // active nav
  const path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-list a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === path || (path === '' && href === 'index.html')) a.classList.add('active');
    if (path === '' && href === 'index.html') a.classList.add('active');
  });
  // copy buttons
  document.querySelectorAll('pre').forEach(pre => {
    const wrap = document.createElement('div');
    wrap.className = 'pre-wrap';
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(pre.innerText);
      btn.textContent = 'Copied';
      setTimeout(()=> btn.textContent='Copy', 1200);
    });
    wrap.appendChild(btn);
  });
  // simple search filter
  const q = document.getElementById('docsSearch');
  if(q){
    q.addEventListener('input', () => {
      const v = q.value.toLowerCase();
      document.querySelectorAll('.nav-list a').forEach(a=>{
        const t = a.textContent.toLowerCase();
        const show = !v || t.includes(v) || a.dataset.tags?.includes(v);
        a.style.display = show ? '' : 'none';
      });
    });
  }
  // anchors
  document.querySelectorAll('h2[id], h3[id]').forEach(h=>{
    const a = document.createElement('a');
    a.href = '#'+h.id; a.className='anchor'; a.textContent='#';
    h.appendChild(a);
  });
});
