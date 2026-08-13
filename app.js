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
    <header class="main-header">
      <!-- Groupe 1 : Navigation principale (Accueil, Explore, Create) -->
      <div class="nav-group-1">
        <a href="index.html" class="nav-icon lang-element" data-titleFr="Accueil" data-titleEn="Home">
          <!-- SVG Maison avec porte en tilde (~) -->
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <!-- Contour de la maison -->
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <!-- Tilde (~) recentré et agrandi, sans la porte -->
            <path d="M8.5 15c1.5-1.5 3-1.5 4 0s3 1.5 4 0"></path>
          </svg>
        </a>
        <a href="explore.html" class="nav-icon lang-element" data-titleFr="Explorer" data-titleEn="Explore">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        </a>
        <a href="create.html" class="nav-icon lang-element" data-titleFr="Créer un défi" data-titleEn="Create challenge">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </a>
      </div>

      <!-- Groupe 2 : Auth / Notifications / Langue / Profil (Rempli dynamiquement) -->
      <div class="nav-group-2" id="nav-auth-section">
        <!-- Injecté par le JS -->
      </div>
    </header>
  `;

   const footerHTML = `
    <footer class="main-footer">
      <div class="logo" style="font-size: 2rem; color: var(--color-text-main);"><span>∿</span>∿</div>
      <div class="footer-tagline">
  <span class="lang-element"
        data-fr='<a href="https://segseq.com" class="segseq-link">SegSeq</a> • Défis Multi-Segments'
        data-en='<a href="https://segseq.com" class="segseq-link">SegSeq</a> • Multi-Segment Challenges'>
    <a href="https://segseq.com" class="segseq-link">SegSeq</a> • Multi-Segment Challenges
  </span>
</div>
      <div class="footer-icons">
        <a href="terms.html" class="footer-icon lang-element" data-titleFr="Conditions d'utilisation" data-titleEn="Terms and conditions">
          <!-- SVG icône Information (i) -->
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
        </a>
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
    const path = window.location.pathname;
    
    if (res.ok) {
      // --- UTILISATEUR CONNECTÉ ---
      sessionStorage.removeItem('locked_challenge'); // On nettoie le verrouillage visiteur
      
      const athlete = await res.json();
      const isRestricted = athlete.restricted_challenge_ids && athlete.restricted_challenge_ids.length > 0;
      
      if (isRestricted) {
        document.body.classList.add('isolated-mode');
        
        // Lockdown : On bloque l'accès à l'accueil, explore et create.
        // On autorise uniquement challenge, terms et profile.
        if (!path.includes('challenge.html') && !path.includes('terms.html') && !path.includes('profile.html')) {
            window.location.href = `/challenge.html?id=${athlete.restricted_challenge_ids[0]}`;
            return; // Stoppe l'exécution
        }
      }

      authSection.innerHTML = `
        <a href="#" class="nav-icon lang-element" data-titleFr="Notifications" data-titleEn="Notifications">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
        </a>
        <div class="lang-selector">
          <span id="btn-en" class="lang-btn" onclick="setLanguage('en')">EN</span>
          <span>|</span>
          <span id="btn-fr" class="lang-btn" onclick="setLanguage('fr')">FR</span>
        </div>
        <a href="profile.html" class="lang-element" data-titleFr="Mon Profil" data-titleEn="My Profile">
          <img src="${athlete.profile}" alt="Profile" class="nav-profile-pic">
        </a>
        <a href="#" onclick="logout(); return false;" class="nav-icon lang-element" data-titleFr="Se déconnecter" data-titleEn="Logout">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
        </a>
      `;
    } else {
      // --- UTILISATEUR NON CONNECTÉ (VISITEUR) ---
      const urlParams = new URLSearchParams(window.location.search);
      const urlChallengeId = urlParams.get('id');

      // S'il atterrit sur un défi, on verrouille sa session
      if (path.includes('challenge.html') && urlChallengeId) {
          sessionStorage.setItem('locked_challenge', urlChallengeId);
      }

      const lockedChallenge = sessionStorage.getItem('locked_challenge');

      if (lockedChallenge) {
          document.body.classList.add('isolated-mode');
          
          // Lockdown : S'il tente d'aller sur l'accueil (/) ou ailleurs que challenge/terms, on le ramène
          if (!path.includes('challenge.html') && !path.includes('terms.html')) {
              window.location.href = `/challenge.html?id=${lockedChallenge}`;
              return; // Stoppe l'exécution
          }
      }
      
      const authUrl = lockedChallenge ? `/api/strava/auth?source_challenge=${lockedChallenge}` : `/api/strava/auth`;

      authSection.innerHTML = `
        <div class="lang-selector" style="margin-right: 15px;">
          <span id="btn-en" class="lang-btn" onclick="setLanguage('en')">EN</span>
          <span>|</span>
          <span id="btn-fr" class="lang-btn" onclick="setLanguage('fr')">FR</span>
        </div>
        <a href="${authUrl}" class="strava-connect-btn">
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
      if (res.ok) {
        sessionStorage.removeItem('locked_challenge'); // <-- LIGNE AJOUTÉE
        window.location.href = '/';
      }
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
/* ------------------------------ 
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
*/

/* ------------------------------ */
/* Gestion Globale de la Vue Admin */
/* ------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  if (localStorage.getItem('adminViewActive') === 'true') {
    document.body.classList.add('view-admin');
  }
});

