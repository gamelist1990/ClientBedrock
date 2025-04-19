document.addEventListener('DOMContentLoaded', function() {
    // Theme Toggle
    const themeToggle = document.querySelector('.theme-toggle');
    const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)');
    
    // Check local storage or system preference for theme
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && prefersDarkScheme.matches)) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
    
    themeToggle.addEventListener('click', function() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
    });
    
    // Tab Navigation
    const tabButtons = document.querySelectorAll('.tab-button');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const tabGroup = this.closest('.tabs');
            const tabName = this.getAttribute('data-tab');
            
            // Update active button
            tabGroup.querySelectorAll('.tab-button').forEach(btn => {
                btn.classList.remove('active');
            });
            this.classList.add('active');
            
            // Show active content
            tabGroup.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            tabGroup.querySelector(`.tab-content[data-tab="${tabName}"]`).classList.add('active');
        });
    });
    
    // Language Selector
    const langButtons = document.querySelectorAll('.lang-btn');
    
    langButtons.forEach(button => {
        button.addEventListener('click', function() {
            const lang = this.getAttribute('data-lang');
            
            // Update active button
            document.querySelectorAll('.lang-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            this.classList.add('active');
            
            // Show active language samples
            document.querySelectorAll('.code-category-tabs').forEach(tab => {
                tab.classList.remove('active');
            });
            document.querySelector(`.${lang}-samples`).classList.add('active');
        });
    });
    
    // Code Category Navigation
    const categoryButtons = document.querySelectorAll('.category-btn');
    
    categoryButtons.forEach(button => {
        button.addEventListener('click', function() {
            const categoryGroup = this.closest('.code-category-tabs');
            const category = this.getAttribute('data-category');
            
            // Update active button
            categoryGroup.querySelectorAll('.category-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            this.classList.add('active');
            
            // Show active content
            categoryGroup.querySelectorAll('.code-sample').forEach(sample => {
                sample.classList.remove('active');
            });
            categoryGroup.querySelector(`.code-sample[data-category="${category}"]`).classList.add('active');
        });
    });
    
    // Copy Code Buttons
    const copyButtons = document.querySelectorAll('.copy-btn');
    
    copyButtons.forEach(button => {
        button.addEventListener('click', function() {
            const preElement = this.parentElement.querySelector('pre code');
            
            if (preElement) {
                const textToCopy = preElement.innerText;
                
                navigator.clipboard.writeText(textToCopy).then(() => {
                    // Change button icon to check mark temporarily
                    const originalHTML = this.innerHTML;
                    this.innerHTML = '<i class="fa-solid fa-check"></i>';
                    
                    setTimeout(() => {
                        this.innerHTML = originalHTML;
                    }, 2000);
                }).catch(err => {
                    console.error('Could not copy text: ', err);
                });
            }
        });
    });
    
    // Smooth Scroll for Navigation Links
    const navLinks = document.querySelectorAll('.nav-link');
    
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            const targetElement = document.querySelector(targetId);
            
            if (targetElement) {
                window.scrollTo({
                    top: targetElement.offsetTop - 60,
                    behavior: 'smooth'
                });
            }
        
