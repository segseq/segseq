/* ------------------------------ */
/* app.js */
/* ------------------------------ */

// Cette fonction DOIT être globale pour que le onclick="" du HTML la trouve
function setLanguage(lang) {
    localStorage.setItem('userLang', lang);
    applyCurrentLanguage();
}

// Fonction pour appliquer la langue au DOM et gérer la surbrillance
function applyCurrentLanguage() {
    const lang = localStorage.getItem('userLang') || 'en'; // Anglais par défaut
    
    // 1. Traduction du texte normal
    const elements = document.querySelectorAll('.lang-element');
    elements.forEach(element => {
        if (element.dataset[lang]) {
            element.textContent = element.dataset[lang];
        }
        
        // 2. Traduction des placeholders
        const placeholderKey = 'placeholder' + lang.charAt(0).toUpperCase() + lang.slice(1);
        if (element.dataset[placeholderKey]) {
            element.placeholder = element.dataset[placeholderKey];
        }

        // 3. Traduction des infobulles (title)
        const titleKey = 'title' + lang.charAt(0).toUpperCase() + lang.slice(1);
        if (element.dataset[titleKey]) {
            element.title = element.dataset[titleKey];
        }
    });

    // 4. Gestion de la surbrillance du sélecteur
    const btnEn = document.getElementById('btn-en');
    const btnFr = document.getElementById('btn-fr');

    if (btnEn && btnFr) {
        if (lang === 'en') {
            btnEn.classList.add('active');
            btnFr.classList.remove('active');
        } else {
            btnFr.classList.add('active');
            btnEn.classList.remove('active');
        }
    }
}

// Appliquer la langue au chargement initial de la page
document.addEventListener("DOMContentLoaded", applyCurrentLanguage);

/* ------------------------------ */
/* components */
/* ------------------------------ */

async function injectComponents() {
  // 1. Définition des templates avec styles intégrés pour la responsivité
  const headerHTML = `
    <header class="main-header">
      <!-- GAUCHE : Logo et Navigation Principale -->
      <div class="nav-group">
        <a href="index.html" class="nav-logo" title="Home"><span>∿</span>segseq</a>
        
        <!-- Explorer (Loupe) -->
        <a href="explore.html" class="nav-icon lang-element" data-titleFr="Explorer" data-titleEn="Explore">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        </a>
        
        <!-- Créer (+) -->
        <a href="create.html" class="nav-icon lang-element" data-titleFr="Créer un défi" data-titleEn="Create challenge">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </a>
        
        <!-- Info (i) -->
        <a href="terms.html" class="nav-icon lang-element" data-titleFr="Informations" data-titleEn="Information">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
        </a>
      </div>
      
      <!-- DROITE : Notifications, Langue et Auth -->
      <div class="nav-group">
        <!-- Notifications (Cloche) -->
        <a href="#" class="nav-icon lang-element" data-titleFr="Notifications (Bientôt)" data-titleEn="Notifications (Coming soon)" onclick="alert('Notifications coming soon!'); return false;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
        </a>

        <!-- Sélecteur EN | FR -->
        <div class="lang-selector">
          <span id="btn-en" class="lang-btn" onclick="setLanguage('en')">EN</span>
          <span class="lang-sep">|</span>
          <span id="btn-fr" class="lang-btn" onclick="setLanguage('fr')">FR</span>
        </div>

        <!-- Zone d'authentification dynamique -->
        <div id="nav-auth-section" style="display: flex; align-items: center; gap: 12px;">
          <!-- Rempli dynamiquement par JS -->
        </div>
      </div>
    </header>
  `;

  const footerHTML = `
    <footer>
      <div class="logo"><span>∿</span>∿</div>
      <div style="margin-bottom: 15px;">
        <span class="lang-element" data-fr="SegSeq • Défis Multi-Segments" data-en="SegSeq • Multi-Segment Challenges">SegSeq • Multi-Segment Challenges</span>
      </div>
      <a href="mailto:info.segseq@gmail.com" class="contact-link lang-element" data-fr="Contactez-nous" data-en="Contact us">Contact us</a>
    </footer>
  `;

  // 2. Injection dans le DOM
  const headerPlaceholder = document.getElementById('header-placeholder');
  const footerPlaceholder = document.getElementById('footer-placeholder');
  
  if(headerPlaceholder) headerPlaceholder.innerHTML = headerHTML;
  if(footerPlaceholder) footerPlaceholder.innerHTML = footerHTML;

  // 3. Logique d'authentification Strava pour le header
  try {
    const res = await fetch("/api/strava?action=getProfile", { credentials: "include" });
    const authSection = document.getElementById('nav-auth-section');
    
    if (res.ok) {
      const athlete = await res.json();
      // Utilisateur Connecté : Photo de profil + Icône Logout
      authSection.innerHTML = `
        <a href="profile.html" class="lang-element" data-titleFr="Mon Profil" data-titleEn="My Profile">
          <img src="${athlete.profile}" alt="Profile" class="nav-profile-pic">
        </a>
        <a href="#" onclick="logout(); return false;" class="nav-icon lang-element" data-titleFr="Se déconnecter" data-titleEn="Logout">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
        </a>
      `;
    } else {
      // Utilisateur Déconnecté : Bouton image Strava
      authSection.innerHTML = `
        <a href="https://segseq.vercel.app/api/strava/auth" class="strava-connect-btn">
          <img src="btn_strava_connect_with_orange.png" alt="Connect with Strava">
        </a>
      `;
    }
  } catch (err) {
    console.error("Erreur de chargement du statut auth:", err);
  }

  // 4. Appliquer la langue au chargement des composants
  if (typeof applyCurrentLanguage === 'function') {
    applyCurrentLanguage();
  }
}

async function logout() {
  const lang = localStorage.getItem('userLang') || 'en';
  const confirmMsg = lang === 'fr' ? "Êtes-vous sûr de vouloir vous déconnecter ?" : "Are you sure you want to log out?";

  if (confirm(confirmMsg)) {
    try {
      const res = await fetch('/api/strava?action=logout', {
        method: 'POST',
        credentials: 'include'
      });

      if (res.ok) {
        window.location.href = '/';
      } else {
        const errorMsg = lang === 'fr' ? "Échec de la déconnexion." : "Logout failed.";
        alert(errorMsg);
      }
    } catch (err) {
      console.error("Erreur réseau lors de la déconnexion:", err);
      const errorMsg = lang === 'fr' ? "Erreur réseau." : "Network error.";
      alert(errorMsg);
    }
  }
}

document.addEventListener("DOMContentLoaded", injectComponents);
