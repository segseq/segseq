// --- language.js ---

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