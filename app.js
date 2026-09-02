const routes = {
  '#home': {
    title: 'المقررات الدراسية',
    desc: '',
    path: 'pages/home.html'
  },
  '#course': {
    title: '',
    desc: '',
    path: 'pages/course.html'
  }
};

function loadPage() {
  const hash = location.hash.split('?')[0] || '#home';
  const route = routes[hash];

  if (!route) return;

  document.getElementById('page-title').textContent = route.title;
  document.getElementById('page-desc').textContent = route.desc;

  fetch(route.path)
    .then(res => res.text())
    .then(html => {
      document.getElementById('page-content').innerHTML = html;
    });
}

window.addEventListener('hashchange', loadPage);
window.addEventListener('DOMContentLoaded', loadPage);
