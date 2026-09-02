class TopBar extends HTMLElement {
  constructor() {
    super();
    
    // إنشاء Shadow DOM مع وضع 'open' للسماح بالوصول من الخارج إذا لزم الأمر
    this.attachShadow({ mode: 'open' });
    
    // إضافة علامة link لتحميل Font Awesome داخل Shadow DOM
    const linkElem = document.createElement('link');
    linkElem.setAttribute('rel', 'stylesheet');
    linkElem.setAttribute('href', 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css');
    
    // إنشاء عنصر style للتنسيقات
    const styleElem = document.createElement('style');
    styleElem.textContent = `
      :host {
        display: block;
        --primary-color: #1a2a6c;
        --secondary-color: #3a7bd5;
        --accent-color: #00d2ff;
        --topbar-height: 70px;
      }
      
      .topbar {
        background: linear-gradient(135deg, var(--primary-color) 0%, var(--secondary-color) 50%, var(--accent-color) 100%);
        color: white;
        padding: 0 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 1000;
        height: var(--topbar-height);
        -webkit-backface-visibility: hidden;
        backface-visibility: hidden;
        font-family: Arial, sans-serif;
      }
      
      .logo-section {
        display: flex;
        align-items: center;
        gap: 15px;
      }
      
      .logo-img {
        height: 35px;
        width: auto;
        transition: transform 0.3s ease;
        cursor: pointer;
      }
      
      .logo-img:hover {
        transform: scale(1.05);
      }
      
      .topbar-icon {
        font-size: 22px;
        cursor: pointer;
        padding: 10px;
        border-radius: 50%;
        transition: all 0.2s ease;
        color: white;
      }
      
      .topbar-icon:hover {
        background-color: rgba(255, 255, 255, 0.15);
      }
      
      .topbar-icon:active {
        transform: scale(0.95);
      }
      
      @media (max-width: 768px) {
        :host {
          --topbar-height: 60px;
        }
        
        .topbar {
          padding: 0 15px;
        }
        
        .logo-img {
          height: 30px;
        }
        
        .topbar-icon {
          font-size: 20px;
          padding: 8px;
        }
      }
    `;
    
    // إنشاء هيكل التوب بار
    const topbar = document.createElement('header');
    topbar.className = 'topbar';
    topbar.innerHTML = `
      <div class="logo-section">
        <i class="fas fa-bars topbar-icon" id="menuBtn"></i>
        <img src="https://github.com/qmsweb/Tools/raw/main/images/rawafid/r-logo.png" 
             alt="شعار روافد" 
             class="logo-img"
             id="logoBtn">
      </div>
      
      <div>
        <i class="fas fa-search topbar-icon" id="searchBtn"></i>
      </div>
    `;
    
    // إضافة العناصر إلى Shadow DOM
    this.shadowRoot.append(linkElem, styleElem, topbar);
  }

  connectedCallback() {
    // إضافة معالجات الأحداث بعد اتصال العنصر بالDOM
    this.shadowRoot.getElementById('menuBtn').addEventListener('click', this.handleMenuClick);
    this.shadowRoot.getElementById('searchBtn').addEventListener('click', this.handleSearchClick);
    this.shadowRoot.getElementById('logoBtn').addEventListener('click', () => {
      window.location.href = 'index.html';
    });
  }

  handleMenuClick = () => {
    // يمكنك إضافة فتح القائمة الجانبية هنا
    console.log('فتح القائمة الجانبية');
    // أو إرسال حدث مخصص
    this.dispatchEvent(new CustomEvent('menu-click'));
  }

  handleSearchClick = () => {
    // يمكنك إضافة فتح شريط البحث هنا
    console.log('فتح شريط البحث');
    // أو إرسال حدث مخصص
    this.dispatchEvent(new CustomEvent('search-click'));
  }

  disconnectedCallback() {
    // تنظيف معالجات الأحداث عند إزالة العنصر
    this.shadowRoot.getElementById('menuBtn').removeEventListener('click', this.handleMenuClick);
    this.shadowRoot.getElementById('searchBtn').removeEventListener('click', this.handleSearchClick);
  }
}

// تسجيل المكون المخصص
if (!customElements.get('top-bar')) {
  customElements.define('top-bar', TopBar);
}
