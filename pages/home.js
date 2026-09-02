const listContainer = document.getElementById("course-list");
const filters = document.querySelectorAll(".filter-item");

let allCourses = [];

function renderCourses(filter = "all") {
  listContainer.innerHTML = "";
  const filtered = filter === "all" ? allCourses : allCourses.filter(c => c.type === filter);

  filtered.forEach(course => {
    const div = document.createElement("div");
    div.className = "course-card";
    div.innerHTML = `
      <div class="item-title">
        <i class="fas fa-book"></i>
        <h3>${course.name}</h3>
      </div>
      <div class="item-footer">
        <a class="btn-enter" href="#course?i=${course.code}">
          <i class="fas fa-arrow-right"></i> دخول
        </a>
      </div>
    `;
    listContainer.appendChild(div);
  });
}

fetch("assets/data/materials.json")
  .then(response => response.json())
  .then(data => {
    allCourses = data;
    renderCourses();
  })
  .catch(error => {
    listContainer.innerHTML = "<p>حدث خطأ أثناء تحميل المقررات.</p>";
    console.error("فشل تحميل البيانات:", error);
  });

filters.forEach(btn => {
  btn.addEventListener("click", () => {
    filters.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    renderCourses(btn.dataset.filter);
  });
});

document.getElementById('grid-view').addEventListener('click', () => {
  listContainer.classList.add('grid-view');
  gridBtn.classList.add('active');
  listBtn.classList.remove('active');
});

document.getElementById('list-view').addEventListener('click', () => {
  listContainer.classList.remove('grid-view');
  listBtn.classList.add('active');
  gridBtn.classList.remove('active');
});
