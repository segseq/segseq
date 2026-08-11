/* ------------------------------ */
/* app.js */
/* ------------------------------ */

function setLanguage(lang) {
    localStorage.setItem('userLang', lang);
    applyCurrentLanguage();
}

function applyCurrentLanguage() {
    const lang = localStorage.getItem('userLang') || 'en';
    
    const elements = document.querySelectorAll('.lang-element');
    elements.forEach(element => {
        if (element.dataset[lang]) element.textContent = element.dataset[lang];
        const placeholderKey = 'placeholder' + lang.charAt(0).toUpperCase() + lang.slice(1);
        if (element.dataset[placeholderKey]) element.placeholder = element.dataset[placeholderKey];
        const titleKey = 'title' + lang.charAt(0).toUpperCase() + lang.slice(1);
        if (element.dataset[titleKey]) element.title = element.dataset[titleKey];
    });

    const btnEn = document.getElementById('btn-en');
    const btnFr = document.getElementById('btn-fr');
    if (btnEn && btnFr) {
        if (lang === 'en') { btnEn.classList.add('active'); btnFr.classList.remove('active'); } 
        else { btnFr.classList.add('active'); btnEn.classList.remove('active'); }
    }
}

document.addEventListener("DOMContentLoaded", applyCurrentLanguage);

/* ------------------------------ */
/* components */
/* ------------------------------ */

async function injectComponents() {
  const headerHTML = `
  <header class="main-header" style="display:flex;align-items:center;justify-content:space-between;">
    
    <!-- 1. Logo -->
    <div class="nav-brand" style="order:1;">
      <a href="index.html" class="nav-logo" title="Home"><span>∿</span>segseq</a>
    </div>
    
    <!-- 2. Menu -->
    <div class="nav-menu" style="order:2;display:flex;align-items:center;gap:20px;">
      <a href="explore.html" class="nav-icon lang-element" data-titleFr="Explorer" data-titleEn="Explore">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
      </a>
      <a href="create.html" class="nav-icon lang-element" data-titleFr="Créer un défi" data-titleEn="Create challenge">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      </a>

      <!-- Lang selector toujours à droite du menu -->
      <div class="lang-selector" style="margin-left:auto;order:3;display:flex;gap:6px;align-items:center;">
        <span id="btn-en" class="lang-btn" onclick="setLanguage('en')">EN</span>
        <span>|</span>
        <span id="btn-fr" class="lang-btn" onclick="setLanguage('fr')">FR</span>
      </div>
    </div>

    <!-- 3. Auth -->
    <div class="nav-auth" id="nav-auth-section" style="order:4;margin-left:20px;">
      <!-- Rempli dynamiquement -->
    </div>

  </header>
`;



   const footerHTML = `
    <footer class="main-footer">
      <div class="logo" style="font-size: 2rem; color: var(--color-text-main);"><span>∿</span>∿</div>
      <div class="footer-tagline">
        <span class="lang-element" data-fr="SegSeq • Défis Multi-Segments" data-en="SegSeq • Multi-Segment Challenges">SegSeq • Multi-Segment Challenges</span>
      </div>
      <div class="footer-icons">
        <a href="mailto:info.segseq@gmail.com" class="footer-icon lang-element" data-titleFr="Nous contacter" data-titleEn="Contact us">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
        </a>
      </div>
    </footer>
  `;

  const headerPlaceholder = document.getElementById('header-placeholder');
  const footerPlaceholder = document.getElementById('footer-placeholder');
  
  if(headerPlaceholder) headerPlaceholder.innerHTML = headerHTML;
  if(footerPlaceholder) footerPlaceholder.innerHTML = footerHTML;

  try {
    const res = await fetch("/api/strava?action=getProfile", { credentials: "include" });
    const authSection = document.getElementById('nav-auth-section');
    
    if (res.ok) {
      const athlete = await res.json();
      authSection.innerHTML = `
        <a href="profile.html" class="lang-element" data-titleFr="Mon Profil" data-titleEn="My Profile">
          <img src="${athlete.profile}" alt="Profile" class="nav-profile-pic">
        </a>
        <a href="#" onclick="logout(); return false;" class="nav-icon lang-element" data-titleFr="Se déconnecter" data-titleEn="Logout">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
        </a>
      `;
    } else {
      authSection.innerHTML = `
        <a href="https://segseq.vercel.app/api/strava/auth" class="strava-connect-btn">
          <img src="btn_strava_connect_with_orange.png" alt="Connect with Strava" style="height:35px;">
        </a>
      `;
    }
  } catch (err) {
    console.error("Auth status error:", err);
  }

  if (typeof applyCurrentLanguage === 'function') applyCurrentLanguage();
}

async function logout() {
  const lang = localStorage.getItem('userLang') || 'en';
  if (confirm(lang === 'fr' ? "Se déconnecter ?" : "Log out?")) {
    try {
      const res = await fetch('/api/strava?action=logout', { method: 'POST', credentials: 'include' });
      if (res.ok) window.location.href = '/';
    } catch (err) {
      console.error(err);
    }
  }
}

document.addEventListener("DOMContentLoaded", injectComponents);

/* ------------------------------ */
/* carousel: Ways To Compete */
/* ------------------------------ */

document.addEventListener('DOMContentLoaded', () => {
  const track = document.getElementById('ways-carousel');
  const dotsContainer = document.getElementById('carousel-dots');
  
  if (track && dotsContainer) {
    const slides = Array.from(track.children);
    let currentIndex = 0;
    let autoSlideInterval;

    slides.forEach((_, index) => {
      const dot = document.createElement('div');
      dot.classList.add('carousel-dot');
      if (index === 0) dot.classList.add('active');
      dot.addEventListener('click', () => { goToSlide(index); resetInterval(); });
      dotsContainer.appendChild(dot);
    });

    const dots = Array.from(dotsContainer.children);

    function goToSlide(index) {
      track.style.transform = `translateX(-${index * 100}%)`;
      dots[currentIndex].classList.remove('active');
      dots[index].classList.add('active');
      currentIndex = index;
    }

    function resetInterval() {
      clearInterval(autoSlideInterval);
      autoSlideInterval = setInterval(() => goToSlide((currentIndex + 1) % slides.length), 5000);
    }
    resetInterval();
  }
});

/* ------------------------------ */
/* PWA: Enregistrement Service Worker dynamique */
/* ------------------------------ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Création d'un Service Worker basique à la volée (évite de créer un fichier sw.js)
    const swCode = `
      const CACHE_NAME = 'segseq-v1';
      self.addEventListener('install', (e) => {
        e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(['/', '/index.html', '/styles.css', '/app.js'])));
      });
      self.addEventListener('fetch', (e) => {
        e.respondWith(caches.match(e.request).then((res) => res || fetch(e.request)));
      });
    `;
    const blob = new Blob([swCode], { type: 'application/javascript' });
    const swUrl = URL.createObjectURL(blob);
    
    navigator.serviceWorker.register(swUrl)
      .then(reg => console.log('PWA: Service Worker enregistré (Blob)'))
      .catch(err => console.log('PWA: Erreur Service Worker', err));
  });
}
