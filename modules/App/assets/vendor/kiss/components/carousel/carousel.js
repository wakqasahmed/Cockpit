import { on, trigger } from '../../js/events.js';

let Animations = {
    default(resolve, current, next) {
        resolve();
    },

    fade(resolve, current, next) {

        current.animate([
            {opacity: 1},
            {opacity: 0}
        ], {
            duration: 250,
        });

        next.animate([
            {opacity: 0},
            {opacity: 1}
        ], {
            duration: 250,
        }).addEventListener('finish', function(e) {
            resolve();
        }, false);
    },

    slide(resolve, current, next) {

        let slides = [...current.parentElement.children],
            dir = slides.indexOf(next) > slides.indexOf(current) ? 1 : -1;

        next.classList.add('visible');

        current.animate([
            {transform: `translateX(${-1 * dir * 100}%)`},
        ], {
            duration: 250,
            easing: 'ease-in-out',
        });

        next.animate([
            {transform: `translateX(${dir * 100}%)`},
            {transform: 'translateX(0)'},
        ], {
            duration: 250,
            easing: 'ease-in-out',
        }).addEventListener('finish', function(e) {
            resolve();
            next.classList.remove('visible');
        }, false);

    }
};

function animate(animation, current, next) {

    return new Promise((resolve, reject) => {
        (Animations[animation] || Animations.default)(resolve, current, next);
    });
}

customElements.define('kiss-carousel', class extends HTMLElement {

    static get observedAttributes() {
        return ['animation'];
    }

    attributeChangedCallback(attrName, oldVal, newVal) {

        switch (attrName) {
            case 'animation':
                this.animation = newVal;
                break;
        }
    }

    connectedCallback() {

        const $this = this;

        this.wrapper = this.querySelector(':scope > kiss-slides') || this;
        this.animation = this.getAttribute('animation') || 'slide';
        this.swipe = this.getAttribute('swipe') === 'false' ? false : true;

        // ARIA: carousel semantics
        this.setAttribute('aria-roledescription', 'carousel');
        if (!this.hasAttribute('aria-label')) {
            this.setAttribute('aria-label', 'Carousel');
        }

        // Make focusable for keyboard navigation
        if (!this.hasAttribute('tabindex')) {
            this.setAttribute('tabindex', '0');
        }

        // ARIA: label each slide
        let allSlides = this.slides();
        let total = allSlides.length;
        allSlides.forEach((slide, idx) => {
            slide.setAttribute('role', 'group');
            slide.setAttribute('aria-roledescription', 'slide');
            slide.setAttribute('aria-label', `Slide ${idx + 1} of ${total}`);
        });

        // Live region for screen reader announcements
        this._liveRegion = document.createElement('div');
        this._liveRegion.setAttribute('aria-live', 'polite');
        this._liveRegion.setAttribute('aria-atomic', 'true');
        this._liveRegion.classList.add('kiss-hidden-visually');
        this.appendChild(this._liveRegion);

        this.setActive(0)

        // events
        on(this, 'click', '[kiss-slide]', function(e) {

            const goto = this.getAttribute('kiss-slide');

            switch(goto) {
                case 'next':
                    $this.nextSlide();
                    break;
                case 'prev':
                    $this.prevSlide();
                    break;
                default:
                    const isNumeric = !isNaN(parseFloat(goto)) && isFinite(goto);

                    if (isNumeric && $this.slides()[Number(goto) - 1]) {
                        $this.setActive(Number(goto) - 1);
                    }
            }
        });

        // Keyboard navigation
        on(this, 'keydown', e => {

            let handled = false;

            switch (e.key) {
                case 'ArrowLeft':
                    this.prevSlide();
                    handled = true;
                    break;
                case 'ArrowRight':
                    this.nextSlide();
                    handled = true;
                    break;
            }

            if (handled) {
                e.preventDefault();
            }
        });

        let pointerStart = null;

        const exclude = 'a, input, textarea, select, button, video, audio';

        on(this.wrapper, 'pointerdown', e => {

            if (!this.swipe ||
                e.target.matches(exclude) ||
                e.target.closest(exclude)
            ) {
                return;
            }

            e.preventDefault();
            pointerStart = e;

        });

        on(this.wrapper, 'pointermove', e => {

            if (!pointerStart) {
                return;
            }

            e.preventDefault();
        });

        on(this.wrapper, 'pointerup', e => {

            if (!pointerStart) return;

            if (pointerStart.clientX < e.clientX) {
                this.prevSlide();
            } else if(pointerStart.clientX > e.clientX) {
                this.nextSlide();
            }

            pointerStart = null;
        });

        document.addEventListener('DOMContentLoaded', () => {
            this.normalize();
        });

        let resizeTicking = false;
        window.addEventListener('resize', () => {
            if (resizeTicking) return;
            resizeTicking = true;
            requestAnimationFrame(() => {
                this.normalize();
                resizeTicking = false;
            });
        }, { passive: true });
    }

    normalize() {

        let height = 0;
        let slides = this.slides();

        slides.forEach(slide => {
            slide.style.height = '';
            height = Math.max(height, slide.offsetHeight);
        });

        [this.wrapper, ...slides].forEach(slide => slide.style.height = `${height}px`)
    }

    slides() {
        return this.wrapper.querySelectorAll(':scope > kiss-slide');
    }

    nextSlide() {

        if (!this.activeSlide) return;

        let slides = this.slides();

        const index = [...slides].indexOf(this.activeSlide);

        this.setActive(slides[index + 1] ? index + 1 : 0);
    }

    prevSlide() {

        if (!this.activeSlide) return;

        let slides = this.slides();

        const index = [...slides].indexOf(this.activeSlide);

        this.setActive(slides[index - 1] ? index - 1 : slides.length - 1);
    }

    setActive(idx) {

        if (this.isAnimating) return;

        const slides = this.slides();
        const slide = slides[idx] || null;

        if (!slide) {
            return;
        }

        // initial
        if (!this.activeSlide && !idx) {
            slide.classList.add('active');
            this.activeSlide = slide;

            if (this._liveRegion) {
                this._liveRegion.textContent = `Slide ${idx + 1} of ${slides.length}`;
            }

            trigger(this, 'carouselenter', {
                detail: {slide: this.activeSlide}
            });
            return;
        }

        this.isAnimating = true;

        trigger(this, 'carouselleave', {
            detail: {slide: this.activeSlide}
        });

        animate(this.animation, this.activeSlide, slide).then(() => {

            this.activeSlide.classList.remove('active');
            slide.classList.add('active');

            // update active triggers
            this.querySelectorAll('[kiss-slide]').forEach(item => {

                item.classList.remove('active');

                if (item.getAttribute('kiss-slide') == String(idx + 1)) {
                    item.classList.add('active');
                }
            });

            this.activeSlide = slide;
            this.isAnimating = false;

            // Announce slide change to screen readers
            if (this._liveRegion) {
                this._liveRegion.textContent = `Slide ${idx + 1} of ${slides.length}`;
            }

            trigger(this, 'carouselenter', {
                detail: {slide: this.activeSlide}
            });
        });
    }
});