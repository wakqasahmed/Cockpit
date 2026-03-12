customElements.define('kiss-tabs', class extends HTMLElement {

    static get observedAttributes() {
        return [];
    }

    constructor() {
        super();
    }

    connectedCallback() {

        if (this.getAttribute('static') == 'true') {
            return;
        }

        this.activeIndex = Number(this.getAttribute('index') || 0);

        this.nav = document.createElement("ul");

        this.nav.classList.add('kiss-tabs-nav');
        this.nav.setAttribute('role', 'tablist');
        this.prepend(this.nav);

        this.render();

        this.addEventListener('click', e => {
            if (!e.target.classList.contains('kiss-tabs-nav-link')) return;
            this.setIndex(e.target.getAttribute('index'));
            e.preventDefault();
        });

        // Keyboard navigation
        this.nav.addEventListener('keydown', e => {

            let link = e.target.closest('.kiss-tabs-nav-link');
            if (!link) return;

            let handled = false;

            switch (e.key) {
                case 'ArrowRight':
                    this.setIndex((this.activeIndex + 1) % this.tabs.length);
                    this.focusActiveTab();
                    handled = true;
                    break;
                case 'ArrowLeft':
                    this.setIndex((this.activeIndex - 1 + this.tabs.length) % this.tabs.length);
                    this.focusActiveTab();
                    handled = true;
                    break;
                case 'Home':
                    this.setIndex(0);
                    this.focusActiveTab();
                    handled = true;
                    break;
                case 'End':
                    this.setIndex(this.tabs.length - 1);
                    this.focusActiveTab();
                    handled = true;
                    break;
            }

            if (handled) {
                e.preventDefault();
            }
        });
    }

    attributeChangedCallback(name, oldvalue, newvalue) {
        if (oldvalue != newvalue) this.render();
    }

    focusActiveTab() {
        let link = this.nav.querySelector('.kiss-tabs-nav-link[aria-selected="true"]');
        if (link) link.focus();
    }

    setIndex(index) {

        this.activeIndex = Number(index);

        this.tabs.forEach((tab, idx) => {

            let isActive = this.activeIndex == idx;
            let link = this.nav.children[idx]?.querySelector('.kiss-tabs-nav-link');

            this.nav.children[idx].setAttribute('active', isActive ? 'true' : 'false');
            tab.setAttribute('active', isActive ? 'true' : 'false');

            // ARIA: tab
            if (link) {
                link.setAttribute('aria-selected', isActive ? 'true' : 'false');
                link.setAttribute('tabindex', isActive ? '0' : '-1');
            }

            // ARIA: panel
            tab.setAttribute('aria-hidden', isActive ? 'false' : 'true');
        });
    }

    render() {

        if (this.getAttribute('static') == 'true') {
            return;
        }

        this.tabs = [];

        this.nav.innerHTML = '';

        let item, counter = 0;

        for (let i = 0; i < this.children.length; i++) {

            if (this.children[i].tagName.toLowerCase() == 'tab') {

                let tabIndex = this.tabs.length;
                let tabId = `kiss-tab-${Date.now()}-${counter}`;
                let panelId = `kiss-tabpanel-${Date.now()}-${counter}`;
                counter++;

                item = document.createElement("li");
                item.setAttribute('role', 'presentation');
                item.innerHTML = `<a class="kiss-tabs-nav-link" role="tab" id="${tabId}" aria-controls="${panelId}" index="${tabIndex}" tabindex="-1">${this.children[i].getAttribute('caption') || 'Tab'}</a>`;
                this.nav.append(item);

                this.tabs.push(this.children[i]);

                // ARIA: panel
                this.children[i].setAttribute('role', 'tabpanel');
                this.children[i].id = panelId;
                this.children[i].setAttribute('aria-labelledby', tabId);
                this.children[i].setAttribute('active', 'false');
                this.children[i].setAttribute('aria-hidden', 'true');
                item.setAttribute('active', 'false');
            }
        }

        this.setIndex(this.activeIndex);
    }
});