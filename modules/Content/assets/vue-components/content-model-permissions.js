export default {

    data() {

        return {
            filter: ''
        }
    },

    props: {
        modelValue: {
            type: Object,
            default: {}
        },
        models: {
            type: Object,
            default: {}
        },
        expressions: {
            type: Object,
            default: {}
        }
    },

    computed: {

        filtered() {

            let models = this.models;

            if (this.filter) {

                const filter = this.filter.toLowerCase();
                const keys = Object.keys(models);
                const vals = Object.values(models);

                models = {};

                keys.forEach((key, i) => {

                    if (`${key} ${vals[i].label || ''}`.toLocaleLowerCase().indexOf(filter) > -1) {
                        models[key] = vals[i];
                    }
                });
            }

            return models;
        }
    },

    methods: {

        hasExpr(permission) {
            return this.expressions[permission]?.expr?.trim();
        },

        editExpression(permission) {

            VueView.ui.modal('system:assets/dialogs/acl-expression.js', {
                permission,
                expression: this.expressions[permission] || null
            }, {
                save: (entry) => {

                    if (entry) {
                        this.expressions[permission] = entry;
                    } else {
                        delete this.expressions[permission];
                    }
                }
            });
        }
    },

    template: /*html*/`
        <div>

            <div class="kiss-margin kiss-size-small kiss-flex kiss-middle">
                <div><field-boolean v-model="modelValue['content/:models/manage']"></field-boolean></div>
                <div class="kiss-flex-1 kiss-margin-small-start">
                    <div :class="{'kiss-color-muted':!modelValue['content/:models/manage']}">
                        {{ t('Manage models') }}
                    </div>
                </div>
            </div>

            <div class="kiss-margin">
                <input class="kiss-input kiss-input-small" type="text" v-model="filter" :placeholder="t('Filter models...')">
            </div>

            <div class="kiss-margin">
                <app-fieldcontainer class="kiss-margin-small" v-for="(model, name) in filtered">

                    <div class="kiss-bgcolor-contrast kiss-padding-small kiss-flex kiss-flex-middle">
                        <span class="kiss-text-bold kiss-size-small kiss-flex-1">
                            <icon class="kiss-margin-xsmall-end kiss-size-5" :style="{color: (model.color || 'inherit')+' !important' }" size="larger">subject</icon> {{model.label || name}}
                        </span>
                        <span class="kiss-text-caption kiss-color-muted kiss-margin-small-start">{{model.type}}</span>
                    </div>
                    <div class="kiss-padding-small">
                        <kiss-row gap="large">
                            <div>
                                <span class="kiss-text-caption">{{ t('Model') }}</span>
                                <kiss-row class="kiss-flex kiss-margin-xsmall kiss-size-small">
                                    <div><input class="kiss-checkbox kiss-margin-xsmall-end" type="checkbox" v-model="modelValue['content/'+name+'/manage']" :value="true"> <span :class="{'kiss-color-muted':!modelValue['content/'+name+'/manage']}">{{ t('Edit model') }}</span></div>
                                </kiss-row>
                            </div>

                            <div v-if="['collection', 'tree'].includes(model.type)">
                                <span class="kiss-text-caption">{{ t('Items') }}</span>
                                <kiss-row class="kiss-flex kiss-margin-xsmall kiss-size-small" gap>
                                    <div><input class="kiss-checkbox kiss-margin-xsmall-end" type="checkbox" v-model="modelValue['content/'+name+'/read']"> <span :class="{'kiss-color-muted':!modelValue['content/'+name+'/read']}">{{ t('Read')}}</span></div>
                                    <div v-if="modelValue['content/'+name+'/read']"><input class="kiss-checkbox kiss-margin-xsmall-end" type="checkbox" v-model="modelValue['content/'+name+'/create']"> <span :class="{'kiss-color-muted':!modelValue['content/'+name+'/create']}">{{ t('Create') }}</span></div>
                                    <div v-if="modelValue['content/'+name+'/read']">
                                        <input class="kiss-checkbox kiss-margin-xsmall-end" type="checkbox" v-model="modelValue['content/'+name+'/update']">
                                        <span :class="{'kiss-color-muted':!modelValue['content/'+name+'/update']}">{{ t('Update') }}</span>
                                        <a v-if="modelValue['content/'+name+'/update']" class="kiss-margin-xsmall-start" :class="hasExpr('content/'+name+'/update') ? 'kiss-color-primary' : 'kiss-color-muted'" @click.stop="editExpression('content/'+name+'/update')"><icon size="small">code</icon></a>
                                    </div>
                                    <div v-if="modelValue['content/'+name+'/read']">
                                        <input class="kiss-checkbox kiss-margin-xsmall-end" type="checkbox" v-model="modelValue['content/'+name+'/delete']">
                                        <span :class="{'kiss-color-muted':!modelValue['content/'+name+'/delete']}">{{ t('Delete') }}</span>
                                        <a v-if="modelValue['content/'+name+'/delete']" class="kiss-margin-xsmall-start" :class="hasExpr('content/'+name+'/delete') ? 'kiss-color-primary' : 'kiss-color-muted'" @click.stop="editExpression('content/'+name+'/delete')"><icon size="small">code</icon></a>
                                    </div>
                                    <div v-if="modelValue['content/'+name+'/read']">
                                        <input class="kiss-checkbox kiss-margin-xsmall-end" type="checkbox" v-model="modelValue['content/'+name+'/publish']">
                                        <span :class="{'kiss-color-muted':!modelValue['content/'+name+'/publish']}">{{ t('Publish') }}</span>
                                        <a v-if="modelValue['content/'+name+'/publish']" class="kiss-margin-xsmall-start" :class="hasExpr('content/'+name+'/publish') ? 'kiss-color-primary' : 'kiss-color-muted'" @click.stop="editExpression('content/'+name+'/publish')"><icon size="small">code</icon></a>
                                    </div>
                                    <div v-if="model.type == 'tree' && modelValue['content/'+name+'/read']"><input class="kiss-checkbox kiss-margin-xsmall-end" type="checkbox" v-model="modelValue['content/'+name+'/updateorder']"> <span :class="{'kiss-color-muted':!modelValue['content/'+name+'/updateorder']}">{{ t('Reorder tree') }}</span></div>
                                </kiss-row>
                            </div>

                            <div v-if="model.type == 'singleton'">
                                <span class="kiss-text-caption">{{ t('Data') }}</span>
                                <kiss-row class="kiss-flex kiss-margin-xsmall kiss-size-small" gap>
                                    <div><input class="kiss-checkbox kiss-margin-xsmall-end" type="checkbox" v-model="modelValue['content/'+name+'/read']"> <span :class="{'kiss-color-muted':!modelValue['content/'+name+'/read']}">{{ t('Read')}}</span></div>
                                    <div v-if="modelValue['content/'+name+'/read']">
                                        <input class="kiss-checkbox kiss-margin-xsmall-end" type="checkbox" v-model="modelValue['content/'+name+'/update']">
                                        <span :class="{'kiss-color-muted':!modelValue['content/'+name+'/update']}">{{ t('Update') }}</span>
                                        <a v-if="modelValue['content/'+name+'/update']" class="kiss-margin-xsmall-start" :class="hasExpr('content/'+name+'/update') ? 'kiss-color-primary' : 'kiss-color-muted'" @click.stop="editExpression('content/'+name+'/update')"><icon size="small">code</icon></a>
                                    </div>
                                    <div v-if="modelValue['content/'+name+'/read']">
                                        <input class="kiss-checkbox kiss-margin-xsmall-end" type="checkbox" v-model="modelValue['content/'+name+'/publish']">
                                        <span :class="{'kiss-color-muted':!modelValue['content/'+name+'/publish']}">{{ t('Publish') }}</span>
                                        <a v-if="modelValue['content/'+name+'/publish']" class="kiss-margin-xsmall-start" :class="hasExpr('content/'+name+'/publish') ? 'kiss-color-primary' : 'kiss-color-muted'" @click.stop="editExpression('content/'+name+'/publish')"><icon size="small">code</icon></a>
                                    </div>
                                </kiss-row>
                            </div>
                        </kiss-row>
                    </div>
                </app-fieldcontainer>
            </div>
        </div>
    `
}
