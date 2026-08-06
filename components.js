async function injectComponents() {
  // 1. Définition des templates
  const headerHTML = `
    <header class="main-header">
      <div class="nav-left">
        <a href="index.html" class="nav-logo"><span>∿</span>segseq</a>
        <div class="dropdown">
          <button class="dropbtn">Menu ▾</button>
          <div class="dropdown-content">
            <a href="explore.html">Explore</a>
            <a href="create.html">Create</a>
			<a href="terms.html">Terms / Privacy</a>
          </div>
        </div>
      </div>
      <div id="nav-auth-section">
        <!-- Rempli dynamiquement -->
      </div>
    </header>
  `;

  const footerHTML = `
    <footer>
      <div class="logo"><span>∿</span>∿</div>
      SegSeq • Multi-Segment Challenges
    </footer>
  `;

  // 2. Injection dans le DOM
  const headerPlaceholder = document.getElementById('header-placeholder');
  const footerPlaceholder = document.getElementById('footer-placeholder');
  
  if(headerPlaceholder) headerPlaceholder.innerHTML = headerHTML;
  
  const dropbtn = document.querySelector('.dropbtn');
    const dropdown = document.querySelector('.dropdown');

if (dropbtn && dropdown) {
    dropbtn.addEventListener('click', () => {
      dropdown.classList.toggle('open');
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
        <a href="https://segseq.vercel.app/api/strava/auth" class="btn btn-primary" style="padding: 10px 20px;">Connect</a>
      `;
    }
  } catch (err) {
    console.error("Erreur de chargement du statut auth:", err);
  }
}

document.addEventListener("DOMContentLoaded", injectComponents);