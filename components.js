async function injectComponents() {
  // 1. Définition des templates
  const headerHTML = `
    <header class="main-header">
      <div class="nav-left" style="display: flex; align-items: center; gap: 10px;">
        <a href="index.html" class="nav-logo"><span>∿</span>segseq</a>
        
        <div class="dropdown">
          <!-- Icône Hamburger à la place du texte -->
          <button class="dropbtn" aria-label="Menu" style="display: flex; align-items: center; justify-content: center; padding: 5px; margin-top: 3px;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
          
          <div class="dropdown-content">
            <a href="explore.html" class="lang-element" data-fr="Explorer" data-en="Explore">Explore</a>
            <a href="create.html" class="lang-element" data-fr="Créer" data-en="Create">Create</a>
            <a href="terms.html" class="lang-element" data-fr="Conditions / Confidentialité" data-en="Terms / Privacy">Terms / Privacy</a>
          </div>
        </div>
      </div>
      
      <!-- Conteneur de droite : Langue + Auth -->
      <div class="nav-right" style="display: flex; align-items: center; gap: 20px;">
        <!-- Sélecteur EN | FR -->
        <div class="lang-selector">
          <span id="btn-en" class="lang-btn" onclick="setLanguage('en')">EN</span>
          <span class="lang-sep">|</span>
          <span id="btn-fr" class="lang-btn" onclick="setLanguage('fr')">FR</span>
        </div>

        <div id="nav-auth-section">
          <!-- Rempli dynamiquement -->
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
      <!-- Bouton de contact discret -->
      <a href="mailto:info.segseq@gmail.com" class="contact-link lang-element" data-fr="Contactez-nous" data-en="Contact us">Contact us</a>
    </footer>
  `;

  // 2. Injection dans le DOM
  const headerPlaceholder = document.getElementById('header-placeholder');
  const footerPlaceholder = document.getElementById('footer-placeholder');
  
  if(headerPlaceholder) headerPlaceholder.innerHTML = headerHTML;
  
  const dropbtn = document.querySelector('.dropbtn');
  const dropdown = document.querySelector('.dropdown');

  if (dropbtn && dropdown) {
    // Permet d'ouvrir/fermer le menu au clic
    dropbtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Empêche le clic de se propager au document
      dropdown.classList.toggle('open');
    });

    // Ferme le menu si on clique n'importe où ailleurs sur la page
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
      }
    });
  }
  
  if(footerPlaceholder) footerPlaceholder.innerHTML = footerHTML;

  // 3. Logique d'authentification Strava pour le header
  try {
    const res = await fetch("/api/strava/me", { credentials: "include" });
    const authSection = document.getElementById('nav-auth-section');
    
    if (res.ok) {
      const athlete = await res.json();
      authSection.innerHTML = `
        <a href="profile.html">
          <img src="${athlete.profile}" alt="Profile" class="nav-profile-pic" title="Go to profile">
        </a>
      `;
    } else {
      authSection.innerHTML = `
        <a href="https://segseq.vercel.app/api/strava/auth" class="btn btn-primary lang-element" data-fr="Se connecter" data-en="Connect" style="padding: 10px 20px;">Connect</a>
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

document.addEventListener("DOMContentLoaded", injectComponents);