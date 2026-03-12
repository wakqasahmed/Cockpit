customElements.define('kiss-accordion', class extends HTMLElement {

    static get observedAttributes() {
        return [];
    }

    constructor() {
        super();
    }

    connectedCallback() {

        // Initialize ARIA on existing triggers
        this.initAria();

        this.addEventListener('click', e => {

            let trigger = e.target.matches('kiss-accordion-trigger') ? e.target : e.target.closest('kiss-accordion-trigger');

            // Only handle if trigger is a direct child of this accordion (not nested)
            if (trigger && trigger.parentElement === this) {
                e.preventDefault();
                e.stopPropagation();
                this.toggle(this.triggerElements().indexOf(trigger));
            }
        });

        // Keyboard navigation
        this.addEventListener('keydown', e => {

            let trigger = e.target.matches('kiss-accordion-trigger') ? e.target : e.target.closest('kiss-accordion-trigger');

            if (!trigger || trigger.parentElement !== this) return;

            let triggers = this.triggerElements();
            let index = triggers.indexOf(trigger);
            let handled = false;

            switch (e.key) {
                case 'ArrowDown':
                    triggers[(index + 1) % triggers.length]?.focus();
                    handled = true;
                    break;
                case 'ArrowUp':
                    triggers[(index - 1 + triggers.length) % triggers.length]?.focus();
                    handled = true;
                    break;
                case 'Home':
                    triggers[0]?.focus();
                    handled = true;
                    break;
                case 'End':
                    triggers[triggers.length - 1]?.focus();
                    handled = true;
                    break;
                case 'Enter':
                case ' ':
                    this.toggle(index);
                    handled = true;
                    break;
            }

            if (handled) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
    }

    initAria() {

        let triggers = this.triggerElements();
        let counter = 0;

        triggers.forEach(trigger => {

            if (!trigger.hasAttribute('tabindex')) {
                trigger.setAttribute('tabindex', '0');
            }
            trigger.setAttribute('role', 'button');

            // Link trigger to its content panel
            let content = trigger.nextElementSibling;

            if (content && content.tagName.toLowerCase() === 'kiss-content') {
                let id = content.id || `kiss-accordion-panel-${Date.now()}-${counter++}`;
                content.id = id;
                content.setAttribute('role', 'region');
                content.setAttribute('aria-labelledby', trigger.id || '');
                trigger.setAttribute('aria-controls', id);
            }

            let isActive = trigger.getAttribute('active') === 'true';
            trigger.setAttribute('aria-expanded', isActive ? 'true' : 'false');
        });
    }

    triggerElements() {

        return Array.from(this.children).filter(c => {
            return c.matches('kiss-accordion-trigger');
        });
    }

    toggle(index = 0) {

        let triggers = this.triggerElements(),
            multiple = this.getAttribute('multiple') !== null;

        triggers.forEach((t, idx) => {

            if (idx == index) {
                let isActive = (!t.getAttribute('active') || t.getAttribute('active') == 'false');
                t.setAttribute('active', isActive ? 'true' : 'false');
                t.setAttribute('aria-expanded', isActive ? 'true' : 'false');
            } else if(!multiple) {
                t.setAttribute('active', 'false');
                t.setAttribute('aria-expanded', 'false');
            }
        });
    }
});