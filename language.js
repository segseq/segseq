function applyCurrentLanguage() {
    const lang = localStorage.getItem('userLang') || 'en';
    
    const elements = document.querySelectorAll('.lang-element');
    elements.forEach(element => {
        // 1. Traduction du texte normal
        if (element.dataset[lang]) {
            element.textContent = element.dataset[lang];
        }
        // 2. Traduction des placeholders (NOUVEAU)
        const placeholderKey = 'placeholder' + lang.charAt(0).toUpperCase() + lang.slice(1); // Donne 'placeholderEn' ou 'placeholderFr'
        if (element.dataset[placeholderKey]) {
            element.placeholder = element.dataset[placeholderKey];
        }
    });

// 3. Traduction des attributs "title" (infobulles)
        const titleKey = 'title' + lang.charAt(0).toUpperCase() + lang.slice(1); // Donne 'titleEn' ou 'titleFr'
        if (element.dataset[titleKey]) {
            element.title = element.dataset[titleKey];
        }

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