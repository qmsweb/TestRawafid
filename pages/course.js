const materialsList = document.getElementById('materials-list');
const filterItems = document.querySelectorAll('.filter-item');
const gridBtn = document.getElementById('grid-view');
const listBtn = document.getElementById('list-view');

const courseCode = new URLSearchParams(location.hash.split('?')[1]).get('i');

let materialsData = [];

function getIconClass(type) {
  switch (type) {
    case 'documents':
      return 'fas fa-file-alt';
    case 'videos':
      return 'fab fa-youtube';
    case 'resources':
      return 'fas fa-bullhorn';
    default:
      return 'fas fa-file';
  }
}

function renderMaterials(filter = 'all') {
  materialsList.innerHTML = '';
  const filtered = filter === 'all' ? materialsData : materialsData.filter(item => item.type === filter);

  filtered.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'material-item';

    const downloadButton = item.download_url ? `
      <a href="${item.download_url}" class="btn btn-download" download>
        <i class="fas fa-download"></i> تحميل
      </a>` : '';

    const previewButton = item.preview_url ? `
      <a href="${item.preview_url}" class="btn btn-preview" target="_blank">
        <i class="${item.type === 'videos' ? 'fas fa-play-circle' : 'fab fa-google-drive'}"></i> 
        ${item.type === 'videos' ? 'مشاهدة' : 'قراءة'}
      </a>` : '';

    let badgeHTML = '';
    const now = Date.now();
    const timeMs = item['time-ms'];
    const MS_IN_DAY = 24 * 60 * 60 * 1000;

    if (item.badge === 'new') {
      const daysSince = timeMs ? Math.floor((now - timeMs) / MS_IN_DAY) : null;
      if (daysSince !== null && daysSince <= 14) {
        badgeHTML = `<span class="badge badge-new">${item.badgeText}</span>`;
      }
    } else if (item.badge) {
      badgeHTML = `<span class="badge badge-${item.badge}">${item.badgeText}</span>`;
    }

    el.innerHTML = `
      <div class="item-title">
        <i class="${getIconClass(item.type)}"></i>
        <h3>${item.title}</h3>
      </div>
      <p class="item-description">${item.description}</p>
      ${badgeHTML}
      <div class="item-footer">
        ${downloadButton}
        ${previewButton}
      </div>
    `;
    materialsList.appendChild(el);
  });
}

filterItems.forEach(item => {
  item.addEventListener('click', function () {
    filterItems.forEach(el => el.classList.remove('active'));
    this.classList.add('active');
    renderMaterials(this.dataset.filter);
  });
});

gridBtn.addEventListener('click', () => {
  materialsList.classList.add('grid-view');
  gridBtn.classList.add('active');
  listBtn.classList.remove('active');
});

listBtn.addEventListener('click', () => {
  materialsList.classList.remove('grid-view');
  listBtn.classList.add('active');
  gridBtn.classList.remove('active');
});

if (!courseCode) {
  materialsList.innerHTML = '<p>⚠️ لم يتم تحديد رمز المقرر في الرابط.</p>';
} else {
  fetch(`assets/data/${courseCode}.json`)
    .then(res => res.json())
    .then(data => {
      materialsData = data.items;
      document.getElementById('page-title').textContent = data.name || 'مقرر دراسي';
      document.getElementById('page-desc').textContent = data.description || '';
      renderMaterials();
    })
    .catch(err => {
      materialsList.innerHTML = `<p>❌ حدث خطأ أثناء تحميل بيانات المقرر: ${err}</p>`;
    });
}
