export default {

    _meta: {
        size: 'medium'
    },

    data() {
        return {
            expr: this.expression?.expr || '',
            msg: this.expression?.msg || '',
            showRef: false
        }
    },

    props: {
        permission: {
            type: String
        },
        expression: {
            type: Object,
            default: null
        }
    },

    methods: {

        save() {

            let expr = this.expr.trim();
            let msg = this.msg.trim();

            this.$call('save', expr ? { expr, ...(msg && { msg }) } : null);
            this.$close();
        },

        insertSnippet(code) {
            this.expr = this.expr ? this.expr + ' ' + code : code;
        }
    },

    template: /*html*/`
        <div>
            <div class="kiss-size-4 kiss-text-bold kiss-margin-small">{{ t('Custom Rule') }}</div>
            <div class="kiss-margin-bottom kiss-size-small kiss-text-monospace kiss-color-muted">{{ permission }}</div>

            <div class="kiss-margin">
                <div class="kiss-flex kiss-flex-middle kiss-margin-xsmall-bottom">
                    <label class="kiss-text-bold kiss-size-small kiss-flex-1">{{ t('Expression') }}</label>
                    <a class="kiss-size-xsmall" :class="showRef ? 'kiss-color-primary' : 'kiss-color-muted'" @click="showRef = !showRef">{{ t('Reference') }} <icon>unfold_more</icon></a>
                </div>

                <kiss-card theme="bordered contrast" v-if="showRef" class="kiss-margin-small kiss-padding-small kiss-size-xsmall" style="border-radius:4px">

                    <div class="kiss-text-bold kiss-margin-xsmall-bottom">{{ t('Variables') }}</div>
                    <div class="kiss-bgcolor-contrast kiss-margin-small-bottom" style="max-height:200px;overflow-y:auto;">
                        <table class="kiss-width-1-1">
                            <tr><td class="kiss-text-monospace" style="width:40%">item._id</td><td class="kiss-color-muted">{{ t('Item ID') }}</td></tr>
                            <tr><td class="kiss-text-monospace">item._cby</td><td class="kiss-color-muted">{{ t('Created by (user ID)') }}</td></tr>
                            <tr><td class="kiss-text-monospace">item._mby</td><td class="kiss-color-muted">{{ t('Modified by (user ID)') }}</td></tr>
                            <tr><td class="kiss-text-monospace">item._state</td><td class="kiss-color-muted">{{ t('Publish state (0=draft, 1=published)') }}</td></tr>
                            <tr><td class="kiss-text-monospace">item._created</td><td class="kiss-color-muted">{{ t('Created timestamp') }}</td></tr>
                            <tr><td class="kiss-text-monospace">item._modified</td><td class="kiss-color-muted">{{ t('Modified timestamp') }}</td></tr>
                            <tr><td class="kiss-text-monospace">item.{field}</td><td class="kiss-color-muted">{{ t('Any content field') }}</td></tr>
                            <tr><td class="kiss-text-monospace">user._id</td><td class="kiss-color-muted">{{ t('Current user ID') }}</td></tr>
                            <tr><td class="kiss-text-monospace">user.user</td><td class="kiss-color-muted">{{ t('Username') }}</td></tr>
                            <tr><td class="kiss-text-monospace">user.email</td><td class="kiss-color-muted">{{ t('User email') }}</td></tr>
                            <tr><td class="kiss-text-monospace">user.role</td><td class="kiss-color-muted">{{ t('User role') }}</td></tr>
                            <tr><td class="kiss-text-monospace">user.{field}</td><td class="kiss-color-muted">{{ t('Any custom user field') }}</td></tr>
                        </table>
                    </div>

                    <div class="kiss-text-bold kiss-margin-xsmall-bottom">{{ t('Examples') }}</div>
                    <div class="kiss-margin-xsmall">
                        <a class="kiss-text-monospace kiss-link-muted" @click="insertSnippet('item._cby === user._id')">item._cby === user._id</a>
                        <div class="kiss-color-muted">{{ t('Only own items') }}</div>
                    </div>
                    <div class="kiss-margin-xsmall">
                        <a class="kiss-text-monospace kiss-link-muted" @click="insertSnippet('item._state === 0')">item._state === 0</a>
                        <div class="kiss-color-muted">{{ t('Only drafts') }}</div>
                    </div>
                    <div class="kiss-margin-xsmall">
                        <a class="kiss-text-monospace kiss-link-muted" @click="insertSnippet('item._cby === user._id || item._state === 0')">item._cby === user._id || item._state === 0</a>
                        <div class="kiss-color-muted">{{ t('Own items or drafts') }}</div>
                    </div>
                </kiss-card>

                <field-code v-model="expr" mode="javascript" :height="150"></field-code>
            </div>

            <div class="kiss-margin">
                <label class="kiss-text-bold kiss-size-small">{{ t('Denial message') }}</label>
                <div class="kiss-color-muted kiss-size-xsmall kiss-margin-xsmall-bottom">{{ t('Optional message shown when the rule denies access') }}</div>
                <input class="kiss-input" type="text" v-model="msg" :placeholder="t('e.g. You can only edit your own items')">
            </div>

            <div class="kiss-margin-top kiss-flex kiss-flex-middle kiss-button-group">
                <button type="button" class="kiss-button kiss-flex-1" @click="$close()">{{ t('Cancel') }}</button>
                <button type="button" class="kiss-button kiss-button-primary kiss-flex-1" @click="save">{{ t('Save') }}</button>
            </div>
        </div>
    `
}
