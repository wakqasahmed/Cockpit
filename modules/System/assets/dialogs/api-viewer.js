export default {

    _meta: { flip: true, size: 'screen' },

    props: {
        openApiUrl: {
            type: String
        },
        apiKey: {
            type: String
        }
    },

    components: {
        'rest-api-playground': Vue.defineAsyncComponent(() =>
            App.utils.import('system:assets/vue-components/api/rest-api-playground.js')
        )
    },

    computed: {
        standaloneUrl() {
            const query = new URLSearchParams({
                specUrl: this.openApiUrl,
                apiKey: this.apiKey || '',
            });

            return this.$routeUrl(`/system/api/restApiViewer?${query.toString()}`);
        }
    },

    template: /*html*/`

        <div class="app-offcanvas-container">
            <div class="kiss-padding kiss-bgcolor-contrast kiss-flex kiss-flex-middle">
                <div class="kiss-flex-1">
                    <div class="kiss-text-bold">{{ t('REST API Playground') }}</div>
                    <div class="kiss-size-xsmall kiss-color-muted">{{ t('OpenAPI powered explorer with live requests') }}</div>
                </div>
                <a class="kiss-button kiss-button-small kiss-margin-small-end kiss-visible@m" :href="standaloneUrl" target="_blank" rel="noopener">
                    {{ t('Open page') }}
                </a>
                <button type="button" class="kiss-button kiss-button-small" kiss-offcanvas-close>{{ t('Close') }}</button>
            </div>
            <div class="app-offcanvas-content kiss-bgcolor-contrast kiss-flex-1">
                <rest-api-playground :open-api-url="openApiUrl" :api-key="apiKey"></rest-api-playground>
            </div>
        </div>
    `,
}
