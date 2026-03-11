<?php

    if (!class_exists('Cockpit')) {
        return;
    }

?>

<vue-view>
    <template>

        <div class="app-restapi-page kiss-flex kiss-flex-column">
            <div class="kiss-padding kiss-bgcolor-contrast kiss-flex kiss-flex-middle">
                <div class="kiss-flex-1">
                    <div class="kiss-text-bold"><?=t('REST API Playground')?></div>
                    <div class="kiss-size-xsmall kiss-color-muted"><?=t('Custom OpenAPI explorer built with Cockpit UI')?></div>
                </div>
                <a class="kiss-button kiss-button-small kiss-margin-small-end" href="<?=$this->route('/system/api')?>"><?=t('Back')?></a>
            </div>
            <div class="app-restapi-page-body kiss-flex-1">
                <rest-api-playground :open-api-url="openApiUrl" :api-key="apiKey"></rest-api-playground>
            </div>
        </div>

    </template>

    <script type="module">

        export default {
            components: {
                'rest-api-playground': 'system:assets/vue-components/api/rest-api-playground.js'
            },

            data() {
                return {
                    openApiUrl: <?=json_encode($openApiUrl)?>,
                    apiKey: <?=json_encode($apiKey)?>,
                }
            }
        }
    </script>
</vue-view>
