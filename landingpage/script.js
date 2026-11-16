/* ============================================
   RWC Indonesia — JavaScript Interactivity
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    // ---- Sticky Header Shadow ----
    const header = document.getElementById('header');
    const onScroll = () => {
        header.classList.toggle('scrolled', window.scrollY > 20);
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // ---- Mobile Hamburger ----
    const hamburger = document.getElementById('hamburger');
    const navLinks = document.getElementById('navLinks');

    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('active');
        navLinks.classList.toggle('active');
    });

    // Close menu on link click
    navLinks.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            hamburger.classList.remove('active');
            navLinks.classList.remove('active');
        });
    });

    // ---- Active Nav On Scroll ----
    const sections = document.querySelectorAll('section[id]');
    const navItems = navLinks.querySelectorAll('a[href^="#"]');

    const highlightNav = () => {
        let current = '';
        sections.forEach(section => {
            const top = section.offsetTop - 120;
            if (window.scrollY >= top) {
                current = section.getAttribute('id');
            }
        });
        navItems.forEach(a => {
            a.classList.remove('active');
            if (a.getAttribute('href') === '#' + current) {
                a.classList.add('active');
            }
        });
    };
    window.addEventListener('scroll', highlightNav, { passive: true });

    // ---- Scroll-Based Animations (Intersection Observer) ----
    const animElements = document.querySelectorAll('.animate-on-scroll');
    const observerOpts = {
        threshold: 0.15,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, i) => {
            if (entry.isIntersecting) {
                // Stagger animations
                setTimeout(() => {
                    entry.target.classList.add('visible');
                }, i * 100);
                observer.unobserve(entry.target);
            }
        });
    }, observerOpts);

    animElements.forEach(el => observer.observe(el));



    // ---- Smooth Scroll for anchor links (fallback) ----
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            const targetEl = document.querySelector(targetId);
            if (targetEl) {
                e.preventDefault();
                const headerOffset = 86;
                const extraOffset = targetId === '#dashboards' ? 220 : 0;
                const targetTop = targetEl.getBoundingClientRect().top + window.scrollY;
                const scrollTo = Math.max(0, targetTop - headerOffset + extraOffset);

                window.scrollTo({
                    top: scrollTo,
                    behavior: 'smooth'
                });
            }
        });
    });

    // ---- Parallax Decorative Circles ----
    const decors = document.querySelectorAll('.hero-decor');
    window.addEventListener('mousemove', (e) => {
        const x = (e.clientX / window.innerWidth - 0.5) * 20;
        const y = (e.clientY / window.innerHeight - 0.5) * 20;
        decors.forEach((d, i) => {
            const speed = (i + 1) * 0.5;
            d.style.transform = `translate(${x * speed}px, ${y * speed}px)`;
            d.style.transition = 'transform .4s ease-out';
        });
    });

});
