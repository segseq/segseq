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
        <a href="https://segseq.com" class="segseq-link">SegSeq</a><span class="lang-element" data-fr=" • Défis Multi-Segments" data-en=" • Multi-Segment Challenges"> • Multi-Segment Challenges</span>
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
      
      // --- CORRECTION DU BUG DE NAVIGATION (MODE ISOLÉ) ---
      let isRestricted = false;
      if (Array.isArray(athlete.restricted_challenge_ids)) {
          // Si c'est un tableau, on filtre les éventuelles valeurs nulles (ex: [null])
          const validIds = athlete.restricted_challenge_ids.filter(id => id !== null && id !== '');
          isRestricted = validIds.length > 0;
      } else if (typeof athlete.restricted_challenge_ids === 'string') {
          // Si c'est une chaîne de caractères, on ignore les formats vides de Postgres (ex: "{}")
          isRestricted = athlete.restricted_challenge_ids.trim() !== '' && athlete.restricted_challenge_ids !== '{}';
      }
      // ----------------------------------------------------
      
      if (isRestricted) {
        document.body.classList.add('isolated-mode');


        authSection.innerHTML = `
        <div class="notification-wrapper" style="position: relative; display: flex; align-items: center;">
          <a href="#" id="notification-bell" class="nav-icon lang-element" data-titleFr="Notifications" data-titleEn="Notifications" onclick="toggleNotifications(event)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
            <span id="notification-badge" class="notification-badge" style="display: none;"></span>
          </a>
          <div id="notification-panel" class="notification-panel" style="display: none;">
            <div class="notification-header lang-element" data-fr="Notifications" data-en="Notifications">Notifications</div>
            <div id="notification-list" class="notification-list"></div>
          </div>
        </div>
        <div class="lang-selector">
          <span id="btn-en" class="lang-btn" onclick="setLanguage('en')">EN</span>
          <span>|</span>
          <span id="btn-fr" class="lang-btn" onclick="setLanguage('fr')">FR</span>
        </div>
        <a href="profile.html" class="lang-element" data-titleFr="Mon Profil" data-titleEn="My Profile">
           <img src="${athlete.profile || '/default-avatar.svg'}" alt="Profile" class="nav-profile-pic">
        </a>
        <a href="#" onclick="logout(); return false;" class="nav-icon lang-element" data-titleFr="Se déconnecter" data-titleEn="Logout">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
        </a>
      `;
	  }
      
      // Appel pour récupérer les notifications juste après l'injection
      fetchUnreadNotifications();

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
  const prevBtn = document.getElementById('ways-prev');
  const nextBtn = document.getElementById('ways-next');
  
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
      if (index < 0) index = slides.length - 1;
      if (index >= slides.length) index = 0;
      track.style.transform = `translateX(-${index * 100}%)`;
      dots[currentIndex].classList.remove('active');
      dots[index].classList.add('active');
      currentIndex = index;
    }

    function resetInterval() {
      clearInterval(autoSlideInterval);
      autoSlideInterval = setInterval(() => goToSlide(currentIndex + 1), 5000);
    }

    if (prevBtn) prevBtn.addEventListener('click', () => { goToSlide(currentIndex - 1); resetInterval(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { goToSlide(currentIndex + 1); resetInterval(); });

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

/* ------------------------------ */
/* Système de Notifications       */
/* ------------------------------ */

async function fetchUnreadNotifications() {
    try {
        // On utilisera webhook.js (ou un autre fichier API existant) pour gérer cette route GET
        const res = await fetch('/api/webhook?action=getNotifications', { credentials: 'include' });
        if (res.ok) {
            const notifications = await res.json();
            const unread = notifications.filter(n => !n.is_read);
            const badge = document.getElementById('notification-badge');
            
            // Afficher la pastille rouge s'il y a des non-lus
            if (badge && unread.length > 0) {
                badge.style.display = 'block';
            }
            
            // Remplir le panneau de notifications
            const list = document.getElementById('notification-list');
            if (list) {
                if (notifications.length === 0) {
                    list.innerHTML = '<div style="padding: 15px; text-align: center; opacity: 0.7;">Aucune notification</div>';
                } else {
                    list.innerHTML = notifications.map(n => `
                        <div class="notif-item ${n.is_read ? '' : 'unread'}" style="padding: 10px; border-bottom: 1px solid var(--color-border); font-size: 0.9rem;">
                            ${n.message}
                            <div style="font-size: 0.75rem; opacity: 0.6; margin-top: 5px;">${new Date(n.created_at).toLocaleDateString()}</div>
                        </div>
                    `).join('');
                }
            }
        }
    } catch (err) {
        console.error("Erreur récupération notifications:", err);
    }
}

function toggleNotifications(event) {
    event.preventDefault();
    const panel = document.getElementById('notification-panel');
    const badge = document.getElementById('notification-badge');
    
    if (panel.style.display === 'none' || panel.style.display === '') {
        panel.style.display = 'block';
        
        // Si on ouvre et qu'il y a une pastille, on marque tout comme lu en arrière-plan
        if (badge.style.display === 'block') {
            fetch('/api/webhook?action=markNotificationsRead', { method: 'POST', credentials: 'include' })
                .catch(err => console.error(err));
            badge.style.display = 'none';
            
            // Retirer visuellement le statut "non lu" des items
            document.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'));
        }
    } else {
        panel.style.display = 'none';
    }
}

// Fermer le panneau si l'utilisateur clique ailleurs sur la page
document.addEventListener('click', (e) => {
    const panel = document.getElementById('notification-panel');
    const bell = document.getElementById('notification-bell');
    if (panel && panel.style.display === 'block' && !panel.contains(e.target) && !bell.contains(e.target)) {
        panel.style.display = 'none';
    }
});
