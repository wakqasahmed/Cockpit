const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];
const REQUEST_MEDIA_PRIORITY = ['application/json', 'multipart/form-data', 'application/x-www-form-urlencoded', 'text/plain'];
const TEXTUAL_RESPONSE_RE = /(^text\/)|json|xml|html|javascript|graphql|yaml|x-www-form-urlencoded/i;
const JSON_RESPONSE_RE = /json|javascript/i;

App.assets.require('system:assets/css/rest-api-playground.css');

const isPlainObject = value => Object.prototype.toString.call(value) === '[object Object]';

const safeClone = value => {

    if (value === undefined) {
        return undefined;
    }

    return JSON.parse(JSON.stringify(value));
};

const createEmptyParams = () => ({
    path: {},
    query: {},
    header: {},
    cookie: {}
});

const hasValue = value => {

    if (value === false || value === 0) {
        return true;
    }

    if (value instanceof File) {
        return true;
    }

    if (Array.isArray(value)) {
        return value.length > 0;
    }

    if (isPlainObject(value)) {
        return Object.keys(value).length > 0;
    }

    return value !== null && value !== undefined && value !== '';
};

const decodePointerToken = token => token.replace(/~1/g, '/').replace(/~0/g, '~');

const resolvePointer = (spec, ref) => {

    if (!ref || !ref.startsWith('#/')) {
        return null;
    }

    return ref
        .slice(2)
        .split('/')
        .map(decodePointerToken)
        .reduce((pointer, part) => pointer && pointer[part] !== undefined ? pointer[part] : null, spec);
};

const resolveValue = (spec, value, seen = new Set()) => {

    if (Array.isArray(value)) {
        return value.map(entry => resolveValue(spec, entry, new Set(seen)));
    }

    if (!isPlainObject(value)) {
        return value;
    }

    if (typeof value.$ref === 'string') {

        if (seen.has(value.$ref)) {
            const loopValue = Object.assign({}, value);
            delete loopValue.$ref;
            return loopValue;
        }

        const target = resolvePointer(spec, value.$ref);

        if (!target) {
            const unresolved = Object.assign({}, value);
            delete unresolved.$ref;
            return unresolved;
        }

        const merged = Object.assign({}, resolveValue(spec, target, new Set([...seen, value.$ref])), value);
        delete merged.$ref;

        return resolveValue(spec, merged, new Set([...seen, value.$ref]));
    }

    const output = {};

    Object.keys(value).forEach(key => {
        output[key] = resolveValue(spec, value[key], seen);
    });

    return output;
};

const mergeSchemas = (base, extra) => {

    const merged = Object.assign({}, base || {}, extra || {});

    if ((base && base.properties) || (extra && extra.properties)) {
        merged.properties = Object.assign({}, base?.properties || {}, extra?.properties || {});
    }

    if ((base && base.required) || (extra && extra.required)) {
        merged.required = Array.from(new Set([...(base?.required || []), ...(extra?.required || [])]));
    }

    if ((base && base.enum) || (extra && extra.enum)) {
        merged.enum = extra?.enum || base?.enum || [];
    }

    return merged;
};

const normalizeSchema = (spec, schema, seen = new Set()) => {

    let resolved = resolveValue(spec, schema, seen);

    if (!isPlainObject(resolved)) {
        return {};
    }

    if (Array.isArray(resolved.allOf) && resolved.allOf.length) {

        let merged = {};

        resolved.allOf.forEach(entry => {
            merged = mergeSchemas(merged, normalizeSchema(spec, entry, seen));
        });

        const rest = Object.assign({}, resolved);
        delete rest.allOf;
        resolved = mergeSchemas(merged, rest);
    }

    if ((!resolved.type || resolved.type === 'null') && Array.isArray(resolved.oneOf) && resolved.oneOf.length) {
        resolved = mergeSchemas(normalizeSchema(spec, resolved.oneOf[0], seen), Object.assign({}, resolved, { oneOf: resolved.oneOf }));
    }

    if (!resolved.type && Array.isArray(resolved.anyOf) && resolved.anyOf.length) {
        resolved = mergeSchemas(normalizeSchema(spec, resolved.anyOf[0], seen), Object.assign({}, resolved, { anyOf: resolved.anyOf }));
    }

    if (!resolved.type) {

        if (resolved.properties || resolved.additionalProperties) {
            resolved.type = 'object';
        } else if (resolved.items) {
            resolved.type = 'array';
        } else if (resolved.enum && resolved.enum.length) {
            resolved.type = typeof resolved.enum[0];
        }
    }

    return resolved;
};

const extractExample = (spec, target) => {

    const resolved = resolveValue(spec, target);

    if (!resolved || typeof resolved !== 'object') {
        return undefined;
    }

    if (resolved.example !== undefined) {
        return safeClone(resolved.example);
    }

    if (resolved.examples) {

        const firstKey = Object.keys(resolved.examples)[0];

        if (firstKey) {

            const example = resolveValue(spec, resolved.examples[firstKey]);

            if (example?.value !== undefined) {
                return safeClone(example.value);
            }
        }
    }

    if (resolved.schema) {
        return extractExample(spec, resolved.schema);
    }

    return undefined;
};

const generateExample = (spec, schema, depth = 0) => {

    if (depth > 6) {
        return null;
    }

    const resolved = normalizeSchema(spec, schema);

    if (!Object.keys(resolved).length) {
        return null;
    }

    if (resolved.example !== undefined) {
        return safeClone(resolved.example);
    }

    if (resolved.default !== undefined) {
        return safeClone(resolved.default);
    }

    if (resolved.enum && resolved.enum.length) {
        return safeClone(resolved.enum[0]);
    }

    if (Array.isArray(resolved.oneOf) && resolved.oneOf.length) {
        return generateExample(spec, resolved.oneOf[0], depth + 1);
    }

    if (Array.isArray(resolved.anyOf) && resolved.anyOf.length) {
        return generateExample(spec, resolved.anyOf[0], depth + 1);
    }

    switch (resolved.type) {
        case 'object': {

            const example = {};

            Object.entries(resolved.properties || {}).forEach(([name, property]) => {
                const value = generateExample(spec, property, depth + 1);

                if (value !== undefined) {
                    example[name] = value;
                }
            });

            if (!Object.keys(example).length && resolved.additionalProperties && resolved.additionalProperties !== true) {
                example.key = generateExample(spec, resolved.additionalProperties, depth + 1);
            }

            return example;
        }

        case 'array': {

            const value = generateExample(spec, resolved.items || {}, depth + 1);

            return value === undefined || value === null ? [] : [value];
        }

        case 'integer':
        case 'number':
            return 0;

        case 'boolean':
            return false;

        case 'string':

            switch (resolved.format) {
                case 'date-time':
                    return new Date().toISOString();
                case 'date':
                    return new Date().toISOString().slice(0, 10);
                case 'email':
                    return 'user@example.com';
                case 'uri':
                    return 'https://example.com';
                case 'uuid':
                    return '00000000-0000-0000-0000-000000000000';
                case 'binary':
                    return '';
            }

            return 'string';
    }

    return null;
};

const isBinarySchema = (spec, schema) => {
    const resolved = normalizeSchema(spec, schema);

    if (resolved.type === 'string' && ['binary', 'base64'].includes(resolved.format)) {
        return true;
    }

    if (resolved.type === 'array') {
        return isBinarySchema(spec, resolved.items || {});
    }

    return false;
};

const formatSchemaLabel = (spec, schema) => {

    const resolved = normalizeSchema(spec, schema);

    if (!Object.keys(resolved).length) {
        return 'any';
    }

    if (resolved.type === 'array') {
        return `array<${formatSchemaLabel(spec, resolved.items || {})}>`;
    }

    if (resolved.enum && resolved.enum.length) {
        return `${resolved.type || 'string'} enum`;
    }

    if (resolved.type === 'string' && resolved.format) {
        return `${resolved.type}:${resolved.format}`;
    }

    return resolved.type || 'any';
};

const formatPreviewValue = (value, mediaType = 'application/json') => {

    if (value === undefined || value === null) {
        return '';
    }

    if (value instanceof File) {
        return `[binary file: ${value.name}]`;
    }

    if (typeof value === 'string') {
        return mediaType.includes('json') ? value : value.trim();
    }

    return JSON.stringify(value, null, 2);
};

const serializeHeaderValue = value => {

    if (Array.isArray(value)) {
        return value.map(serializeHeaderValue).join(',');
    }

    if (isPlainObject(value)) {
        return Object.entries(value).map(([key, entry]) => `${key}=${serializeHeaderValue(entry)}`).join(',');
    }

    return String(value);
};

const shellEscape = value => "'" + String(value).replace(/'/g, "'\"'\"'") + "'";

const normalizeServerUrl = (server, fallbackUrl) => {

    if (!server) {
        return fallbackUrl || '';
    }

    let url = server.url || fallbackUrl || '';

    Object.entries(server.variables || {}).forEach(([name, config]) => {
        url = url.replace(new RegExp(`{${name}}`, 'g'), config.default || config.enum?.[0] || '');
    });

    return url;
};

const buildServerOptions = (spec, specUrl) => {

    const fallback = (() => {

        if (!specUrl) {
            return '/api';
        }

        const normalized = new URL(specUrl, window.location.href);

        return `${normalized.origin}/api`;
    })();

    const servers = Array.isArray(spec?.servers) && spec.servers.length ? spec.servers : [{ url: fallback }];

    return servers.map((server, index) => ({
        label: server.description || server.url || `Server ${index + 1}`,
        url: normalizeServerUrl(server, fallback),
    }));
};

const getPreferredRequestMediaType = content => {

    const contentTypes = Object.keys(content || {});

    if (!contentTypes.length) {
        return '';
    }

    const preferred = REQUEST_MEDIA_PRIORITY.find(type => contentTypes.includes(type));

    return preferred || contentTypes[0];
};

const sortResponses = entries => {

    return entries.sort((a, b) => {

        if (a.code === 'default') return 1;
        if (b.code === 'default') return -1;

        return Number(a.code) - Number(b.code);
    });
};

const buildResponses = (spec, responses) => {

    const entries = Object.entries(responses || {}).map(([code, response]) => {

        const resolved = resolveValue(spec, response);
        const content = resolved.content || {};
        const contentTypes = Object.keys(content);
        const preferredMediaType = getPreferredRequestMediaType(content);
        const media = preferredMediaType ? resolveValue(spec, content[preferredMediaType]) : null;
        const example = media ? extractExample(spec, media) : undefined;
        const preview = example !== undefined ? example : media?.schema ? generateExample(spec, media.schema) : null;

        return {
            code,
            description: resolved.description || '',
            contentTypes,
            preferredMediaType,
            preview,
            previewText: formatPreviewValue(preview, preferredMediaType),
        };
    });

    return sortResponses(entries);
};

const mergeParameters = (spec, pathParameters, operationParameters) => {

    const merged = new Map();

    [...(pathParameters || []), ...(operationParameters || [])].forEach(parameter => {

        const resolved = resolveValue(spec, parameter);
        const key = `${resolved.in}:${resolved.name}`;

        merged.set(key, resolved);
    });

    return Array.from(merged.values());
};

const buildOperations = spec => {

    const operations = [];

    Object.entries(spec?.paths || {}).forEach(([path, pathItem]) => {

        const resolvedPathItem = resolveValue(spec, pathItem);
        const pathParameters = resolvedPathItem.parameters || [];

        HTTP_METHODS.forEach(method => {

            if (!resolvedPathItem[method]) {
                return;
            }

            const operation = resolveValue(spec, resolvedPathItem[method]);
            const parameters = mergeParameters(spec, pathParameters, operation.parameters || []);
            const requestBody = operation.requestBody ? resolveValue(spec, operation.requestBody) : null;
            const responses = buildResponses(spec, operation.responses);
            const tags = operation.tags && operation.tags.length ? operation.tags : ['general'];
            const id = operation.operationId || `${method}:${path}`;

            operations.push({
                id,
                method,
                methodUpper: method.toUpperCase(),
                path,
                tags,
                operationId: operation.operationId || '',
                summary: operation.summary || `${path}`,
                description: operation.description || '',
                deprecated: !!operation.deprecated,
                parameters,
                requestBody,
                responses,
                security: operation.security !== undefined ? operation.security : (spec.security || []),
                search: [method, path, operation.summary, operation.description, operation.operationId, tags.join(' ')].join(' ').toLowerCase(),
            });
        });
    });

    return operations.sort((a, b) => {

        if (a.tags[0] !== b.tags[0]) {
            return a.tags[0].localeCompare(b.tags[0]);
        }

        if (a.path !== b.path) {
            return a.path.localeCompare(b.path);
        }

        return HTTP_METHODS.indexOf(a.method) - HTTP_METHODS.indexOf(b.method);
    });
};

const createAuthState = (name, scheme, apiKey = '') => {

    const state = {
        value: '',
        username: '',
        password: '',
    };

    if (scheme.type === 'apiKey' && apiKey && /api[-_]?key|cockpit-token/i.test(`${name} ${scheme.name || ''}`)) {
        state.value = apiKey;
    }

    return state;
};

const createParameterInitialValue = (spec, parameter) => {

    const example = extractExample(spec, parameter);

    if (example !== undefined) {
        return example;
    }

    const schema = normalizeSchema(spec, parameter.schema || {});

    if (parameter.in === 'path') {
        const value = generateExample(spec, schema);
        return hasValue(value) ? value : parameter.name;
    }

    if (schema.default !== undefined) {
        return safeClone(schema.default);
    }

    switch (schema.type) {
        case 'object':
            return {};
        case 'array':
            return [];
        case 'boolean':
            return parameter.required ? false : '';
        default:
            return '';
    }
};

const joinUrl = (base, path) => {

    if (!base) {
        return path;
    }

    if (/^https?:\/\//i.test(path)) {
        return path;
    }

    return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
};

const JsonNode = {
    name: 'json-node',
    props: {
        data: [Object, Array, String, Number, Boolean],
        name: [String, Number],
        isLast: Boolean,
        depth: {
            type: Number,
            default: 0
        }
    },
    data() {
        return {
            expanded: this.depth < 2
        }
    },
    computed: {
        type() {

            if (this.data === null) {
                return 'null';
            }

            return Array.isArray(this.data) ? 'array' : typeof this.data;
        },
        isPrimitive() {
            return this.type !== 'object' && this.type !== 'array';
        },
        hasChildren() {
            return !this.isPrimitive && Object.keys(this.data || {}).length > 0;
        },
        keys() {
            return this.isPrimitive ? [] : Object.keys(this.data || {});
        }
    },
    methods: {
        toggle() {
            this.expanded = !this.expanded;
        }
    },
    template: /*html*/`
        <div class="app-restapi-json-node kiss-text-monospace" :class="'depth-'+depth">
            <div v-if="isPrimitive">
                <span class="kiss-color-muted" v-if="name !== undefined">{{ name }}: </span>
                <span :class="{
                    'kiss-color-primary': type === 'string',
                    'kiss-color-success': type === 'number',
                    'kiss-color-danger': type === 'boolean',
                    'kiss-color-muted': type === 'null'
                }">{{ type === 'string' ? '"' + data + '"' : data }}</span><span v-if="!isLast">,</span>
            </div>
            <div v-else>
                <div class="kiss-flex kiss-flex-middle">
                    <a class="kiss-margin-small-end kiss-color-muted" @click="toggle" v-if="hasChildren">
                        <icon>{{ expanded ? 'arrow_drop_down' : 'arrow_right' }}</icon>
                    </a>
                    <span class="kiss-margin-small-end" v-else>&nbsp;&nbsp;&nbsp;</span>
                    <span class="kiss-color-muted" v-if="name !== undefined">{{ name }}: </span>
                    <span class="kiss-color-muted" @click="hasChildren && toggle()">
                        {{ type === 'array' ? '[' : '{' }}
                        <span v-if="!expanded && hasChildren"> ... </span>
                        <span v-if="!hasChildren || !expanded">
                            {{ type === 'array' ? ']' : '}' }}<span v-if="!isLast">,</span>
                        </span>
                    </span>
                </div>
                <div v-if="expanded && hasChildren" class="kiss-margin-left">
                    <json-node
                        v-for="(key, index) in keys"
                        :key="key"
                        :data="data[key]"
                        :name="type === 'array' ? index : key"
                        :is-last="index === keys.length - 1"
                        :depth="depth + 1">
                    </json-node>
                </div>
                <div v-if="expanded && hasChildren" class="kiss-color-muted">
                    {{ type === 'array' ? ']' : '}' }}<span v-if="!isLast">,</span>
                </div>
            </div>
        </div>
    `
};

const PlaygroundField = {
    name: 'playground-field',
    props: {
        modelValue: {
            default: ''
        },
        schema: {
            type: Object,
            default: () => ({})
        },
        required: {
            type: Boolean,
            default: false
        },
        disabled: {
            type: Boolean,
            default: false
        },
        forceFile: {
            type: Boolean,
            default: false
        },
        multiline: {
            type: Boolean,
            default: false
        },
        rows: {
            type: Number,
            default: 4
        }
    },
    components: {
        'field-object': Vue.defineAsyncComponent(() => App.utils.import('app:assets/vue-components/fields/field-object.js')),
        'field-text': Vue.defineAsyncComponent(() => App.utils.import('app:assets/vue-components/fields/field-text.js'))
    },
    computed: {
        normalizedSchema() {
            return this.schema || {};
        },
        fieldKind() {

            if (this.forceFile) {
                return this.normalizedSchema.type === 'array' ? 'file-array' : 'file';
            }

            if (this.normalizedSchema.enum && this.normalizedSchema.enum.length) {
                return 'select';
            }

            if (this.normalizedSchema.type === 'boolean') {
                return 'boolean';
            }

            if (['number', 'integer'].includes(this.normalizedSchema.type)) {
                return 'number';
            }

            if (this.normalizedSchema.type === 'object' || this.normalizedSchema.properties) {
                return 'object';
            }

            if (this.normalizedSchema.type === 'array') {

                if (this.normalizedSchema.items?.type === 'object' || this.normalizedSchema.items?.properties) {
                    return 'object';
                }

                if (['binary', 'base64'].includes(this.normalizedSchema.items?.format)) {
                    return 'file-array';
                }

                return 'array';
            }

            return this.multiline ? 'textarea' : 'text';
        },
        arrayText() {

            if (Array.isArray(this.modelValue)) {
                return this.modelValue.join('\n');
            }

            return this.modelValue || '';
        },
        objectValue() {

            if (this.modelValue === '' || this.modelValue === null || this.modelValue === undefined) {
                return this.normalizedSchema.type === 'array' ? [] : {};
            }

            return this.modelValue;
        },
        booleanValue() {

            if (this.modelValue === true) {
                return 'true';
            }

            if (this.modelValue === false) {
                return 'false';
            }

            return '';
        }
    },
    methods: {
        updateText(value) {
            this.$emit('update:modelValue', value);
        },
        updateNumber(value) {
            this.$emit('update:modelValue', value === '' ? '' : Number(value));
        },
        updateBoolean(value) {
            this.$emit('update:modelValue', value === '' ? '' : value === 'true');
        },
        updateArray(value) {
            this.$emit('update:modelValue', value ? value.split('\n').map(entry => entry.trim()).filter(Boolean) : []);
        },
        updateFile(event) {
            const files = Array.from(event.target.files || []);
            this.$emit('update:modelValue', this.fieldKind === 'file-array' ? files : (files[0] || null));
        }
    },
    template: /*html*/`
        <div class="app-restapi-input-control">

            <select class="kiss-select kiss-width-1-1" :value="modelValue" :disabled="disabled" @change="updateText($event.target.value)" v-if="fieldKind === 'select'">
                <option value="" v-if="!required"></option>
                <option v-for="option in normalizedSchema.enum" :key="option" :value="option">{{ option }}</option>
            </select>

            <select class="kiss-select kiss-width-1-1" :value="booleanValue" :disabled="disabled" @change="updateBoolean($event.target.value)" v-else-if="fieldKind === 'boolean'">
                <option value="" v-if="!required"></option>
                <option value="true">true</option>
                <option value="false">false</option>
            </select>

            <input type="number" class="kiss-input kiss-width-1-1" :value="modelValue" :disabled="disabled" @input="updateNumber($event.target.value)" v-else-if="fieldKind === 'number'">

            <input type="file" class="kiss-input kiss-width-1-1" :disabled="disabled" :multiple="fieldKind === 'file-array'" @change="updateFile" v-else-if="fieldKind === 'file' || fieldKind === 'file-array'">

            <field-object :model-value="objectValue" :strict="true" :height="180" @update:modelValue="$emit('update:modelValue', $event)" v-else-if="fieldKind === 'object'"></field-object>

            <field-text :model-value="arrayText" :multiline="true" :height="(rows * 24) + 'px'" @update:modelValue="updateArray($event)" v-else-if="fieldKind === 'array'"></field-text>

            <field-text :model-value="modelValue || ''" :multiline="true" :height="(rows * 24) + 'px'" @update:modelValue="updateText($event)" v-else-if="fieldKind === 'textarea'"></field-text>

            <input type="text" class="kiss-input kiss-width-1-1" :value="modelValue" :disabled="disabled" @input="updateText($event.target.value)" v-else>

        </div>
    `
};

export default {

    components: {
        JsonNode,
        PlaygroundField,
        'field-code': Vue.defineAsyncComponent(() => App.utils.import('app:assets/vue-components/fields/field-code.js')),
        'field-object': Vue.defineAsyncComponent(() => App.utils.import('app:assets/vue-components/fields/field-object.js'))
    },

    props: {
        openApiUrl: {
            type: String,
            required: true
        },
        apiKey: {
            type: String,
            default: ''
        }
    },

    data() {
        return {
            loading: true,
            error: null,
            spec: null,
            operations: [],
            serverOptions: [],
            filter: '',
            expandedTags: {},
            selectedOperationId: null,
            selectedResponseCode: '',
            selectedRequestMediaType: '',
            serverUrl: '',
            authValues: {},
            parameterValues: createEmptyParams(),
            requestState: {
                json: {},
                text: '',
                form: {},
                files: {},
                binary: null,
            },
            response: null,
            responseTab: 'body',
            submitting: false
        }
    },

    computed: {
        normalizedSpecUrl() {

            const url = new URL(this.openApiUrl, window.location.href);

            if (url.pathname.endsWith('/system/api/openapi') && !url.searchParams.has('format')) {
                url.searchParams.set('format', 'json');
            }

            return url.toString();
        },

        selectedOperation() {
            return this.operations.find(operation => operation.id === this.selectedOperationId) || null;
        },

        filteredTagGroups() {

            const groups = new Map();
            const term = this.filter.trim().toLowerCase();

            this.operations
                .filter(operation => !term || operation.search.includes(term))
                .forEach(operation => {

                    operation.tags.forEach(tag => {

                        if (!groups.has(tag)) {
                            groups.set(tag, []);
                        }

                        groups.get(tag).push(operation);
                    });
                });

            return Array.from(groups.entries()).map(([tag, operations]) => ({ tag, operations }));
        },

        parameterGroups() {

            if (!this.selectedOperation) {
                return [];
            }

            return ['path', 'query', 'header', 'cookie']
                .map(location => ({
                    location,
                    label: this.locationLabel(location),
                    parameters: this.selectedOperation.parameters.filter(parameter => parameter.in === location)
                }))
                .filter(group => group.parameters.length);
        },

        selectedRequestContent() {

            if (!this.selectedOperation?.requestBody?.content || !this.selectedRequestMediaType) {
                return null;
            }

            return resolveValue(this.spec, this.selectedOperation.requestBody.content[this.selectedRequestMediaType]);
        },

        selectedRequestSchema() {
            return normalizeSchema(this.spec, this.selectedRequestContent?.schema || {});
        },

        selectedRequestExample() {

            if (!this.selectedRequestContent) {
                return null;
            }

            const example = extractExample(this.spec, this.selectedRequestContent);

            return example !== undefined ? example : generateExample(this.spec, this.selectedRequestContent.schema);
        },

        selectedRequestExampleText() {
            return formatPreviewValue(this.selectedRequestExample, this.selectedRequestMediaType);
        },

        requestBodyMode() {

            if (!this.selectedRequestContent || !this.selectedRequestMediaType) {
                return '';
            }

            if (['multipart/form-data', 'application/x-www-form-urlencoded'].includes(this.selectedRequestMediaType)) {
                return 'form';
            }

            if (this.selectedRequestMediaType.includes('json')) {
                return 'json';
            }

            if (isBinarySchema(this.spec, this.selectedRequestContent.schema)) {
                return 'binary';
            }

            return 'text';
        },

        requestEditorMode() {

            if (this.selectedRequestMediaType.includes('xml')) {
                return 'xml';
            }

            if (this.selectedRequestMediaType.includes('yaml')) {
                return 'yaml';
            }

            return null;
        },

        activeFormFields() {

            if (this.requestBodyMode !== 'form') {
                return [];
            }

            const required = this.selectedRequestSchema.required || [];

            return Object.entries(this.selectedRequestSchema.properties || {}).map(([name, schema]) => ({
                name,
                schema: normalizeSchema(this.spec, schema),
                required: required.includes(name),
            }));
        },

        operationSecurityNames() {

            const names = new Set();

            (this.selectedOperation?.security || []).forEach(requirement => {
                Object.keys(requirement).forEach(name => names.add(name));
            });

            return names;
        },

        authSchemeEntries() {

            const schemes = resolveValue(this.spec, this.spec?.components?.securitySchemes || {});

            return Object.entries(schemes).map(([name, scheme]) => {

                let mode = scheme.type;

                if (scheme.type === 'http' && scheme.scheme === 'bearer') {
                    mode = 'bearer';
                }

                if (scheme.type === 'http' && scheme.scheme === 'basic') {
                    mode = 'basic';
                }

                return {
                    name,
                    mode,
                    scheme,
                    required: this.operationSecurityNames.has(name),
                };
            });
        },

        requestPreview() {
            return this.composeRequestPreview();
        },

        requestUrlPreview() {
            return this.requestPreview.url;
        },

        curlCommand() {
            return this.requestPreview.curl;
        },

        requestWarnings() {
            return this.requestPreview.warnings;
        },

        responseHeaderEntries() {
            return Object.entries(this.response?.headers || {}).map(([name, value]) => ({ name, value }));
        }
    },

    mounted() {
        this.loadSpec();
    },

    watch: {
        openApiUrl() {
            this.loadSpec();
        },
        selectedOperationId() {
            this.initializeOperationState();
        },
        selectedRequestMediaType() {
            this.initializeRequestState();
        }
    },

    methods: {

        locationLabel(location) {

            switch (location) {
                case 'path': return this.t('Path params');
                case 'query': return this.t('Query params');
                case 'header': return this.t('Headers');
                case 'cookie': return this.t('Cookies');
            }

            return location;
        },

        methodTheme(method) {
            return `app-restapi-method--${method}`;
        },

        statusTheme(status) {

            if (status >= 200 && status < 300) return 'kiss-color-success';
            if (status >= 400 && status < 500) return 'kiss-color-warning';
            if (status >= 500) return 'kiss-color-danger';
            return 'kiss-color-muted';
        },

        renderRichText(text) {

            if (!text) {
                return '';
            }

            return App.utils.escape(text)
                .replace(/`([^`]+)`/g, '<code>$1</code>')
                .replace(/\n/g, '<br>');
        },

        async loadSpec() {

            this.loading = true;
            this.error = null;
            this.response = null;

            try {

                const response = await fetch(this.normalizedSpecUrl, {
                    credentials: 'same-origin',
                    headers: {
                        'Accept': 'application/json'
                    }
                });

                if (!response.ok) {
                    throw new Error(`${response.status} ${response.statusText}`);
                }

                const contentType = response.headers.get('content-type') || '';
                let spec = null;

                if (contentType.includes('json')) {
                    spec = await response.json();
                } else {

                    const text = await response.text();

                    try {
                        spec = JSON.parse(text);
                    } catch (error) {
                        throw new Error('The custom REST viewer expects an OpenAPI JSON document. Use ?format=json for Cockpit generated specs.');
                    }
                }

                this.spec = spec;
                this.operations = buildOperations(spec);
                this.serverOptions = buildServerOptions(spec, this.normalizedSpecUrl);
                this.serverUrl = this.serverOptions[0]?.url || '';
                this.initializeAuthState();

                this.expandedTags = {};
                this.filteredTagGroups.forEach(group => {
                    this.expandedTags[group.tag] = true;
                });

                this.selectedOperationId = this.operations[0]?.id || null;

            } catch (error) {

                this.error = error.message || 'Failed to load OpenAPI spec.';

            } finally {
                this.loading = false;
            }
        },

        initializeAuthState() {

            this.authValues = {};

            this.authSchemeEntries.forEach(entry => {
                this.authValues[entry.name] = createAuthState(entry.name, entry.scheme, this.apiKey);
            });
        },

        initializeOperationState() {

            if (!this.selectedOperation) {
                return;
            }

            const nextParams = createEmptyParams();

            this.selectedOperation.parameters.forEach(parameter => {
                nextParams[parameter.in][parameter.name] = createParameterInitialValue(this.spec, parameter);
            });

            this.parameterValues = nextParams;
            this.selectedResponseCode = this.selectedOperation.responses[0]?.code || '';
            this.selectedRequestMediaType = getPreferredRequestMediaType(this.selectedOperation.requestBody?.content || {});
            this.response = null;
            this.responseTab = 'body';
            this.initializeRequestState();
        },

        initializeRequestState() {

            this.requestState = {
                json: {},
                text: '',
                form: {},
                files: {},
                binary: null,
            };

            if (!this.selectedRequestContent) {
                return;
            }

            if (this.requestBodyMode === 'json') {
                this.requestState.json = this.selectedRequestExample !== null ? safeClone(this.selectedRequestExample) : {};
                return;
            }

            if (this.requestBodyMode === 'text') {
                this.requestState.text = this.selectedRequestExampleText;
                return;
            }

            if (this.requestBodyMode === 'binary') {
                this.requestState.binary = null;
                return;
            }

            if (this.requestBodyMode === 'form') {

                const example = isPlainObject(this.selectedRequestExample) ? this.selectedRequestExample : {};

                this.activeFormFields.forEach(field => {

                    if (isBinarySchema(this.spec, field.schema)) {
                        this.requestState.files[field.name] = field.schema.type === 'array' ? [] : null;
                    } else {

                        if (example[field.name] !== undefined) {
                            this.requestState.form[field.name] = safeClone(example[field.name]);
                            return;
                        }

                        const value = generateExample(this.spec, field.schema);

                        if (value !== undefined && value !== null) {
                            this.requestState.form[field.name] = value;
                        } else if (field.schema.type === 'object') {
                            this.requestState.form[field.name] = {};
                        } else if (field.schema.type === 'array') {
                            this.requestState.form[field.name] = [];
                        } else {
                            this.requestState.form[field.name] = '';
                        }
                    }
                });
            }
        },

        selectOperation(operation) {
            this.selectedOperationId = operation.id;
        },

        toggleTag(tag) {
            this.expandedTags[tag] = !this.expandedTags[tag];
        },

        schemaLabel(schema) {
            return formatSchemaLabel(this.spec, schema);
        },

        normalizedSchemaForField(schema) {
            return normalizeSchema(this.spec, schema || {});
        },

        isBinaryField(schema) {
            return isBinarySchema(this.spec, schema);
        },

        buildPath(path) {

            return path.replace(/\{([^}]+)\}/g, (match, name) => {

                const value = this.parameterValues.path[name];

                return encodeURIComponent(hasValue(value) ? value : name);
            });
        },

        appendQueryParam(searchParams, parameter, value) {

            if (!hasValue(value)) {
                return;
            }

            if (Array.isArray(value)) {

                if (parameter.explode === false) {
                    searchParams.append(parameter.name, value.map(entry => serializeHeaderValue(entry)).join(','));
                    return;
                }

                value.forEach(entry => searchParams.append(parameter.name, serializeHeaderValue(entry)));
                return;
            }

            if (isPlainObject(value)) {

                if (parameter.explode === false) {
                    searchParams.append(parameter.name, Object.entries(value).flatMap(([key, entry]) => [key, serializeHeaderValue(entry)]).join(','));
                    return;
                }

                Object.entries(value).forEach(([key, entry]) => {
                    searchParams.append(key, serializeHeaderValue(entry));
                });

                return;
            }

            searchParams.append(parameter.name, serializeHeaderValue(value));
        },

        serializeParamValue(parameter, value) {

            if (!hasValue(value)) {
                return '';
            }

            if (Array.isArray(value)) {
                return value.map(entry => serializeHeaderValue(entry)).join(',');
            }

            if (isPlainObject(value)) {

                if (parameter.explode === false) {
                    return Object.entries(value).flatMap(([key, entry]) => [key, serializeHeaderValue(entry)]).join(',');
                }

                return Object.entries(value).map(([key, entry]) => `${key}=${serializeHeaderValue(entry)}`).join(',');
            }

            return serializeHeaderValue(value);
        },

        composeRequestPreview() {

            if (!this.selectedOperation) {
                return { url: '', curl: '', warnings: [] };
            }

            const warnings = [];
            const headers = {};
            const cookies = [];
            const searchParams = new URLSearchParams();
            const curlParts = [`curl -X ${this.selectedOperation.methodUpper}`];

            this.parameterGroups.forEach(group => {
                group.parameters.forEach(parameter => {

                    const value = this.parameterValues[group.location][parameter.name];

                    if (!hasValue(value)) {
                        return;
                    }

                    switch (group.location) {
                        case 'query':
                            this.appendQueryParam(searchParams, parameter, value);
                            break;

                        case 'header':
                            headers[parameter.name] = this.serializeParamValue(parameter, value);
                            break;

                        case 'cookie':
                            cookies.push(`${parameter.name}=${this.serializeParamValue(parameter, value)}`);
                            warnings.push('Cookie parameters can be previewed in cURL but cannot be sent from the browser.');
                            break;
                    }
                });
            });

            this.authSchemeEntries.forEach(entry => {

                const state = this.authValues[entry.name] || {};

                if (entry.mode === 'apiKey' && hasValue(state.value)) {

                    if (entry.scheme.in === 'query') {
                        searchParams.append(entry.scheme.name, state.value);
                    } else if (entry.scheme.in === 'header') {
                        headers[entry.scheme.name] = state.value;
                    } else if (entry.scheme.in === 'cookie') {
                        cookies.push(`${entry.scheme.name}=${state.value}`);
                        warnings.push('Cookie based authentication can be previewed in cURL but cannot be sent from the browser.');
                    }
                }

                if (entry.mode === 'bearer' && hasValue(state.value)) {
                    headers.Authorization = `Bearer ${state.value}`;
                }

                if (entry.mode === 'basic' && hasValue(state.username) && hasValue(state.password)) {
                    headers.Authorization = `Basic ${btoa(`${state.username}:${state.password}`)}`;
                }
            });

            const url = joinUrl(this.serverUrl, this.buildPath(this.selectedOperation.path));
            const queryString = searchParams.toString();
            const finalUrl = queryString ? `${url}${url.includes('?') ? '&' : '?'}${queryString}` : url;

            curlParts.push(shellEscape(finalUrl));

            Object.entries(headers).forEach(([name, value]) => {
                curlParts.push(`-H ${shellEscape(`${name}: ${value}`)}`);
            });

            if (cookies.length) {
                curlParts.push(`--cookie ${shellEscape(cookies.join('; '))}`);
            }

            if (this.selectedOperation.method !== 'get' && this.selectedOperation.method !== 'head') {

                if (this.requestBodyMode === 'json') {
                    headers['Content-Type'] = this.selectedRequestMediaType;
                    curlParts.push(`-H ${shellEscape(`Content-Type: ${this.selectedRequestMediaType}`)}`);
                    curlParts.push(`--data-raw ${shellEscape(JSON.stringify(this.requestState.json, null, 2))}`);
                }

                if (this.requestBodyMode === 'text' && hasValue(this.requestState.text)) {
                    headers['Content-Type'] = this.selectedRequestMediaType;
                    curlParts.push(`-H ${shellEscape(`Content-Type: ${this.selectedRequestMediaType}`)}`);
                    curlParts.push(`--data-raw ${shellEscape(this.requestState.text)}`);
                }

                if (this.requestBodyMode === 'binary' && this.requestState.binary instanceof File) {
                    curlParts.push(`--data-binary ${shellEscape(`@${this.requestState.binary.name}`)}`);
                }

                if (this.requestBodyMode === 'form') {

                    if (this.selectedRequestMediaType === 'application/x-www-form-urlencoded') {

                        const body = new URLSearchParams();

                        Object.entries(this.requestState.form).forEach(([name, value]) => {

                            if (hasValue(value)) {
                                body.append(name, isPlainObject(value) || Array.isArray(value) ? JSON.stringify(value) : String(value));
                            }
                        });

                        const bodyValue = body.toString();

                        if (bodyValue) {
                            curlParts.push(`-H ${shellEscape(`Content-Type: ${this.selectedRequestMediaType}`)}`);
                            curlParts.push(`--data-raw ${shellEscape(bodyValue)}`);
                        }

                    } else {

                        Object.entries(this.requestState.form).forEach(([name, value]) => {

                            if (hasValue(value)) {
                                curlParts.push(`-F ${shellEscape(`${name}=${isPlainObject(value) || Array.isArray(value) ? JSON.stringify(value) : value}`)}`);
                            }
                        });

                        Object.entries(this.requestState.files).forEach(([name, value]) => {

                            if (!hasValue(value)) {
                                return;
                            }

                            if (Array.isArray(value)) {
                                value.forEach(file => curlParts.push(`-F ${shellEscape(`${name}=@${file.name}`)}`));
                                return;
                            }

                            curlParts.push(`-F ${shellEscape(`${name}=@${value.name}`)}`);
                        });
                    }
                }
            }

            return {
                url: finalUrl,
                curl: curlParts.join(' \\\n  '),
                warnings: Array.from(new Set(warnings)),
                headers,
            };
        },

        buildFetchBody() {

            if (!this.selectedOperation || ['get', 'head'].includes(this.selectedOperation.method)) {
                return undefined;
            }

            switch (this.requestBodyMode) {
                case 'json':
                    return JSON.stringify(this.requestState.json, null, 2);

                case 'text':
                    return this.requestState.text || '';

                case 'binary':
                    return this.requestState.binary || undefined;

                case 'form':

                    if (this.selectedRequestMediaType === 'application/x-www-form-urlencoded') {

                        const body = new URLSearchParams();

                        Object.entries(this.requestState.form).forEach(([name, value]) => {

                            if (hasValue(value)) {
                                body.append(name, isPlainObject(value) || Array.isArray(value) ? JSON.stringify(value) : String(value));
                            }
                        });

                        return body;
                    }

                    const formData = new FormData();

                    Object.entries(this.requestState.form).forEach(([name, value]) => {

                        if (hasValue(value)) {
                            formData.append(name, isPlainObject(value) || Array.isArray(value) ? JSON.stringify(value) : value);
                        }
                    });

                    Object.entries(this.requestState.files).forEach(([name, value]) => {

                        if (!hasValue(value)) {
                            return;
                        }

                        if (Array.isArray(value)) {
                            value.forEach(file => formData.append(name, file));
                            return;
                        }

                        formData.append(name, value);
                    });

                    return formData;
            }

            return undefined;
        },

        async sendRequest() {

            if (!this.selectedOperation) {
                return;
            }

            this.submitting = true;
            this.response = null;

            const startedAt = performance.now();
            const preview = this.composeRequestPreview();
            const headers = Object.assign({}, preview.headers);
            const body = this.buildFetchBody();

            if (this.requestBodyMode === 'json' || this.requestBodyMode === 'text') {
                headers['Content-Type'] = this.selectedRequestMediaType;
            }

            if (this.requestBodyMode === 'form' && this.selectedRequestMediaType === 'application/x-www-form-urlencoded') {
                headers['Content-Type'] = this.selectedRequestMediaType;
            }

            try {

                const response = await fetch(preview.url, {
                    method: this.selectedOperation.methodUpper,
                    headers,
                    body,
                    credentials: 'same-origin'
                });

                const elapsed = Math.round(performance.now() - startedAt);
                const responseHeaders = Object.fromEntries(response.headers.entries());
                const contentType = responseHeaders['content-type'] || '';
                let bodyType = 'empty';
                let data = null;
                let text = '';
                let size = 0;

                if (![204, 205, 304].includes(response.status)) {

                    if (TEXTUAL_RESPONSE_RE.test(contentType)) {

                        text = await response.text();
                        size = new Blob([text]).size;

                        if (JSON_RESPONSE_RE.test(contentType)) {

                            try {
                                data = JSON.parse(text);
                                bodyType = 'json';
                            } catch (error) {
                                bodyType = 'text';
                            }

                        } else {
                            bodyType = 'text';
                        }

                    } else {

                        const blob = await response.blob();
                        size = blob.size;
                        bodyType = 'binary';
                        data = {
                            type: blob.type || contentType || 'application/octet-stream',
                            size: blob.size
                        };
                    }
                }

                this.response = {
                    ok: response.ok,
                    status: response.status,
                    statusText: response.statusText,
                    elapsed,
                    headers: responseHeaders,
                    contentType,
                    bodyType,
                    data,
                    text,
                    size
                };

            } catch (error) {

                this.response = {
                    ok: false,
                    status: 0,
                    statusText: 'Network error',
                    elapsed: Math.round(performance.now() - startedAt),
                    headers: {},
                    contentType: '',
                    bodyType: 'text',
                    data: null,
                    text: error.message || String(error),
                    size: 0
                };
            }

            this.responseTab = 'body';
            this.submitting = false;
        },

        resetComposer() {
            this.initializeOperationState();
        },

        copyCurl() {
            App.utils.copyText(this.curlCommand, () => App.ui.notify('cURL copied!'));
        },

        copyResponse() {

            if (!this.response) {
                return;
            }

            const body = this.response.bodyType === 'json'
                ? JSON.stringify(this.response.data, null, 2)
                : this.response.bodyType === 'binary'
                    ? JSON.stringify(this.response.data, null, 2)
                    : this.response.text;

            App.utils.copyText(body, () => App.ui.notify('Response copied!'));
        }
    },

    template: /*html*/`
        <div class="app-restapi-playground">

            <aside class="app-restapi-sidebar">
                <div class="app-restapi-sidebar-head">
                    <div class="kiss-text-caption kiss-color-muted">OpenAPI</div>
                    <div class="app-restapi-spec-title">{{ spec?.info?.title || t('API Reference') }}</div>
                    <div class="kiss-flex kiss-flex-middle kiss-margin-small-top" gap="small">
                        <span class="kiss-badge kiss-badge-outline kiss-color-primary">{{ spec?.openapi || '3.x' }}</span>
                        <span class="kiss-size-xsmall kiss-color-muted">{{ operations.length }} {{ t('endpoints') }}</span>
                    </div>
                </div>

                <div class="app-restapi-sidebar-search">
                    <input type="search" class="kiss-input kiss-width-1-1" :placeholder="t('Search endpoints...')" v-model="filter">
                </div>

                <div class="app-restapi-sidebar-body">
                    <div class="kiss-padding-large kiss-align-center" v-if="loading">
                        <app-loader></app-loader>
                    </div>

                    <div class="app-restapi-empty" v-else-if="error">
                        <div class="kiss-text-bold">{{ t('Spec loading failed') }}</div>
                        <div class="kiss-size-small kiss-color-muted kiss-margin-small-top">{{ error }}</div>
                    </div>

                    <div class="app-restapi-empty" v-else-if="!filteredTagGroups.length">
                        <div class="kiss-text-bold">{{ t('No endpoints found') }}</div>
                        <div class="kiss-size-small kiss-color-muted kiss-margin-small-top">{{ t('Try a different search term.') }}</div>
                    </div>

                    <div v-else>
                        <section class="app-restapi-tag-group" v-for="group in filteredTagGroups" :key="group.tag">
                            <button type="button" class="app-restapi-tag-toggle" @click="toggleTag(group.tag)">
                                <span class="kiss-align-start kiss-text-capitalize kiss-flex-1">{{ group.tag }}</span>
                                <span class="kiss-size-xsmall kiss-color-muted">{{ group.operations.length }}</span>
                                <icon class="kiss-margin-small-start kiss-color-muted">{{ expandedTags[group.tag] ? 'expand_less' : 'expand_more' }}</icon>
                            </button>

                            <div v-if="expandedTags[group.tag]">
                                <a
                                    class="app-restapi-operation-link"
                                    :class="{ active: selectedOperationId === operation.id }"
                                    href="#"
                                    @click.prevent="selectOperation(operation)"
                                    v-for="operation in group.operations"
                                    :key="operation.id">
                                    <span class="app-restapi-method" :class="methodTheme(operation.method)">{{ operation.methodUpper }}</span>
                                    <span class="app-restapi-operation-copy">
                                        <span class="app-restapi-operation-summary">{{ operation.summary }}</span>
                                        <span class="app-restapi-operation-path kiss-text-monospace">{{ operation.path }}</span>
                                    </span>
                                </a>
                            </div>
                        </section>
                    </div>
                </div>
            </aside>

            <section class="app-restapi-docs">
                <div class="app-restapi-empty" v-if="loading">
                    <app-loader></app-loader>
                </div>

                <div class="app-restapi-empty" v-else-if="error">
                    <div class="kiss-text-bold">{{ t('OpenAPI spec unavailable') }}</div>
                    <div class="kiss-size-small kiss-color-muted kiss-margin-small-top">{{ error }}</div>
                </div>

                <div class="app-restapi-empty" v-else-if="!selectedOperation">
                    <div class="kiss-text-bold">{{ t('Select an endpoint') }}</div>
                    <div class="kiss-size-small kiss-color-muted kiss-margin-small-top">{{ t('Choose an operation from the sidebar to inspect its docs.') }}</div>
                </div>

                <template v-else>
                    <div class="app-restapi-hero">
                        <div class="app-restapi-hero-path">
                            <span class="app-restapi-method" :class="methodTheme(selectedOperation.method)">{{ selectedOperation.methodUpper }}</span>
                            <span class="app-restapi-path kiss-text-monospace">{{ selectedOperation.path }}</span>
                        </div>
                        <div class="kiss-flex kiss-flex-middle">
                            <span class="kiss-badge kiss-badge-outline kiss-margin-small-end" v-if="selectedOperation.deprecated">{{ t('Deprecated') }}</span>
                            <button type="button" class="kiss-button kiss-button-small" @click="App.utils.copyText(requestUrlPreview, () => App.ui.notify('Request URL copied!'))">{{ t('Copy URL') }}</button>
                        </div>
                    </div>

                    <div class="app-restapi-description" v-if="selectedOperation.description" v-html="renderRichText(selectedOperation.description)"></div>

                    <div class="app-restapi-chip-row">
                        <span class="kiss-badge kiss-badge-outline" v-for="tag in selectedOperation.tags" :key="tag">{{ tag }}</span>
                        <span class="kiss-badge kiss-badge-outline kiss-color-primary" v-if="selectedOperation.operationId">{{ selectedOperation.operationId }}</span>
                        <span class="kiss-badge kiss-badge-outline kiss-color-warning" v-for="name in operationSecurityNames" :key="name">{{ name }}</span>
                    </div>

                    <section class="app-restapi-section" v-if="parameterGroups.length">
                        <div class="app-restapi-section-head">
                            <div class="app-restapi-section-title">{{ t('Parameters') }}</div>
                        </div>

                        <div class="app-restapi-form-grid" v-for="group in parameterGroups" :key="group.location">
                            <div class="app-restapi-subtitle kiss-text-caption">{{ group.label }}</div>

                            <label class="app-restapi-field" v-for="parameter in group.parameters" :key="group.location + ':' + parameter.name">
                                <div class="app-restapi-field-top">
                                    <span class="app-restapi-field-name">{{ parameter.name }}</span>
                                    <span class="kiss-badge kiss-badge-outline" v-if="parameter.required">{{ t('Required') }}</span>
                                    <span class="kiss-badge kiss-badge-outline kiss-color-primary">{{ schemaLabel(parameter.schema) }}</span>
                                </div>
                                <div class="app-restapi-field-help" v-if="parameter.description" v-html="renderRichText(parameter.description)"></div>
                                <playground-field
                                    v-model="parameterValues[group.location][parameter.name]"
                                    :schema="normalizedSchemaForField(parameter.schema)"
                                    :required="parameter.required"
                                    :disabled="group.location === 'cookie'">
                                </playground-field>
                            </label>
                        </div>
                    </section>

                    <section class="app-restapi-section" v-if="selectedRequestContent">
                        <div class="app-restapi-section-head">
                            <div class="app-restapi-section-title">{{ t('Request body') }}</div>
                            <div class="app-restapi-chip-row">
                                <button
                                    type="button"
                                    class="app-restapi-chip-button"
                                    :class="{ active: selectedRequestMediaType === mediaType }"
                                    @click="selectedRequestMediaType = mediaType"
                                    v-for="mediaType in Object.keys(selectedOperation.requestBody.content || {})"
                                    :key="mediaType">
                                    {{ mediaType }}
                                </button>
                            </div>
                        </div>

                        <div class="app-restapi-description kiss-margin-small-bottom" v-if="selectedOperation.requestBody?.description" v-html="renderRichText(selectedOperation.requestBody.description)"></div>

                        <field-object
                            v-model="requestState.json"
                            :strict="true"
                            :height="260"
                            v-if="requestBodyMode === 'json'">
                        </field-object>

                        <field-code
                            v-model="requestState.text"
                            :height="260"
                            :mode="requestEditorMode"
                            v-else-if="requestBodyMode === 'text'">
                        </field-code>

                        <div v-else-if="requestBodyMode === 'binary'">
                            <playground-field
                                v-model="requestState.binary"
                                :schema="selectedRequestSchema"
                                :required="selectedOperation.requestBody?.required"
                                :force-file="true">
                            </playground-field>
                        </div>

                        <div v-else-if="requestBodyMode === 'form'">
                            <div class="app-restapi-form-grid" v-if="activeFormFields.length">
                                <label class="app-restapi-field" v-for="field in activeFormFields" :key="field.name">
                                    <div class="app-restapi-field-top">
                                        <span class="app-restapi-field-name">{{ field.name }}</span>
                                        <span class="kiss-badge kiss-badge-outline" v-if="field.required">{{ t('Required') }}</span>
                                        <span class="kiss-badge kiss-badge-outline kiss-color-primary">{{ schemaLabel(field.schema) }}</span>
                                    </div>
                                    <playground-field
                                        v-if="!isBinaryField(field.schema)"
                                        v-model="requestState.form[field.name]"
                                        :schema="field.schema"
                                        :required="field.required">
                                    </playground-field>
                                    <playground-field
                                        v-else
                                        v-model="requestState.files[field.name]"
                                        :schema="field.schema"
                                        :required="field.required"
                                        :force-file="true">
                                    </playground-field>
                                </label>
                            </div>

                            <field-object v-else v-model="requestState.form" :strict="true" :height="220"></field-object>
                        </div>
                    </section>

                    <div class="kiss-button-group app-restapi-actions">
                        <button type="button" class="kiss-button kiss-button-small kiss-button-primary" @click="sendRequest" :disabled="submitting">
                            {{ submitting ? t('Sending...') : t('Send request') }}
                        </button>
                        <button type="button" class="kiss-button kiss-button-small" @click="resetComposer">{{ t('Reset') }}</button>
                    </div>

                    <div class="kiss-size-small kiss-color-warning kiss-margin-small-top" v-if="requestWarnings.length">
                        <div v-for="warning in requestWarnings" :key="warning">{{ warning }}</div>
                    </div>

                    <section class="app-restapi-section">
                        <div class="app-restapi-section-head">
                            <div class="app-restapi-section-title">cURL</div>
                            <button type="button" class="kiss-button kiss-button-small" @click="copyCurl">{{ t('Copy') }}</button>
                        </div>
                        <field-code :model-value="curlCommand" :height="180" :codemirror="{ readOnly: true, lineWrapping: true }"></field-code>
                    </section>

                    <section class="app-restapi-section" v-if="selectedOperation.responses.length">
                        <div class="app-restapi-section-head">
                            <div class="app-restapi-section-title">{{ t('Expected responses') }}</div>
                        </div>

                        <article class="app-restapi-response-doc" v-for="entry in selectedOperation.responses" :key="entry.code">
                            <div class="kiss-flex kiss-flex-middle">
                                <span class="kiss-badge kiss-badge-outline" :class="statusTheme(Number(entry.code) || 0)">{{ entry.code }}</span>
                                <span class="kiss-margin-small-start kiss-flex-1">{{ entry.description || t('Response') }}</span>
                            </div>
                            <div class="app-restapi-chip-row" v-if="entry.contentTypes.length">
                                <span class="kiss-badge kiss-badge-outline" v-for="contentType in entry.contentTypes" :key="contentType">{{ contentType }}</span>
                            </div>
                            <pre class="app-restapi-codeblock kiss-text-monospace" v-if="entry.previewText">{{ entry.previewText }}</pre>
                        </article>
                    </section>
                </template>
            </section>

            <aside class="app-restapi-console">
                <div class="app-restapi-console-scroll" v-if="selectedOperation && !loading && !error">

                    <section class="app-restapi-section" v-if="serverOptions.length > 1 || requestUrlPreview">
                        <div class="app-restapi-section-head">
                            <div class="app-restapi-section-title">{{ t('Server') }}</div>
                        </div>
                        <select class="kiss-select kiss-width-1-1" v-model="serverUrl" v-if="serverOptions.length > 1">
                            <option v-for="server in serverOptions" :key="server.url" :value="server.url">{{ server.label }}</option>
                        </select>
                        <div class="app-restapi-url-preview kiss-text-monospace">{{ requestUrlPreview }}</div>
                    </section>

                    <section class="app-restapi-section" v-if="authSchemeEntries.length">
                        <div class="app-restapi-section-head">
                            <div class="app-restapi-section-title">{{ t('Authentication') }}</div>
                        </div>

                        <article class="app-restapi-auth-card" v-for="entry in authSchemeEntries" :key="entry.name">
                            <div class="kiss-flex kiss-flex-middle">
                                <div class="kiss-flex-1">
                                    <div class="kiss-text-bold">{{ entry.name }}</div>
                                    <div class="kiss-size-xsmall kiss-color-muted">
                                        <span v-if="entry.mode === 'apiKey'">{{ entry.scheme.in }}: {{ entry.scheme.name }}</span>
                                        <span v-else-if="entry.mode === 'bearer'">Authorization: Bearer</span>
                                        <span v-else-if="entry.mode === 'basic'">Authorization: Basic</span>
                                        <span v-else>{{ entry.scheme.type }}</span>
                                    </div>
                                </div>
                                <span class="kiss-badge kiss-badge-outline kiss-color-warning" v-if="entry.required">{{ t('Required') }}</span>
                            </div>

                            <div class="kiss-margin-small-top" v-if="entry.mode === 'apiKey' || entry.mode === 'bearer'">
                                <input type="text" class="kiss-input kiss-width-1-1" v-model="authValues[entry.name].value" :placeholder="t('Token value')">
                            </div>

                            <div class="kiss-margin-small-top kiss-grid" style="--kiss-grid-gap:10px;" v-else-if="entry.mode === 'basic'">
                                <div>
                                    <input type="text" class="kiss-input kiss-width-1-1" v-model="authValues[entry.name].username" :placeholder="t('Username')">
                                </div>
                                <div>
                                    <input type="password" class="kiss-input kiss-width-1-1" v-model="authValues[entry.name].password" :placeholder="t('Password')">
                                </div>
                            </div>

                            <div class="kiss-size-small kiss-color-muted kiss-margin-small-top" v-else>
                                {{ t('This auth scheme is not yet interactive in the custom playground.') }}
                            </div>
                        </article>
                    </section>

                    <section class="app-restapi-section app-restapi-response-panel">
                        <div class="app-restapi-section-head">
                            <div class="app-restapi-section-title">{{ t('Response') }}</div>
                            <div class="kiss-flex kiss-flex-middle" v-if="response">
                                <span class="kiss-badge kiss-badge-outline" :class="statusTheme(response.status)">{{ response.status || 'ERR' }}</span>
                                <span class="kiss-size-xsmall kiss-color-muted kiss-margin-small-start">{{ response.elapsed }}ms</span>
                                <span class="kiss-size-xsmall kiss-color-muted kiss-margin-small-start" v-if="response.size">{{ App.utils.formatSize(response.size) }}</span>
                                <button type="button" class="kiss-button kiss-button-small kiss-margin-small-start" @click="copyResponse">{{ t('Copy') }}</button>
                            </div>
                        </div>

                        <div class="app-restapi-empty" v-if="!response">
                            <div class="kiss-text-bold">{{ t('No response yet') }}</div>
                            <div class="kiss-size-small kiss-color-muted kiss-margin-small-top">{{ t('Run the request to inspect headers and payload.') }}</div>
                        </div>

                        <template v-else>
                            <div class="app-restapi-tabbar">
                                <button type="button" class="app-restapi-tab" :class="{ active: responseTab === 'body' }" @click="responseTab = 'body'">{{ t('Body') }}</button>
                                <button type="button" class="app-restapi-tab" :class="{ active: responseTab === 'headers' }" @click="responseTab = 'headers'">{{ t('Headers') }}</button>
                            </div>

                            <div v-if="responseTab === 'body'">
                                <div class="kiss-size-small kiss-color-muted kiss-margin-small-bottom" v-if="response.statusText">{{ response.statusText }}</div>

                                <div class="app-restapi-json-view" v-if="response.bodyType === 'json'">
                                    <json-node :data="response.data" :is-last="true"></json-node>
                                </div>

                                <div class="app-restapi-empty" v-else-if="response.bodyType === 'binary'">
                                    <div class="kiss-text-bold">{{ t('Binary response') }}</div>
                                    <div class="kiss-size-small kiss-color-muted kiss-margin-small-top">{{ response.data.type }}</div>
                                </div>

                                <field-code
                                    v-else
                                    :model-value="response.text"
                                    :height="220"
                                    :mode="response.contentType.includes('xml') ? 'xml' : null"
                                    :codemirror="{ readOnly: true, lineWrapping: true }">
                                </field-code>
                            </div>

                            <div v-else class="app-restapi-header-table">
                                <div class="app-restapi-header-row" v-for="entry in responseHeaderEntries" :key="entry.name">
                                    <div class="app-restapi-header-name kiss-text-monospace">{{ entry.name }}</div>
                                    <div class="app-restapi-header-value kiss-text-monospace">{{ entry.value }}</div>
                                </div>
                            </div>
                        </template>
                    </section>
                </div>
            </aside>
        </div>
    `
}
