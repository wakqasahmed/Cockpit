<?php

/**
 * Strict SVG sanitizer for uploaded SVG assets.
 *
 * This implementation is intentionally SVG-focused. Generic XML files should
 * not be passed through it, because it strips unsafe XML constructs and only
 * preserves a vetted subset of SVG elements, attributes, and CSS.
 */
class SVGSanitizer
{

    protected const ALLOWED_DATA_IMAGE_REGEX = '/^data:image\/(?:avif|gif|jpe?g|pjpeg|png|webp)(?:;base64)?,/i';
    protected const FORBIDDEN_CSS_PATTERN = '/(?:@import|@namespace|expression\s*\(|behaviou?r\s*:|-moz-binding|javascript\s*:|vbscript\s*:|livescript\s*:|mocha\s*:)/i';
    protected const REMOTE_URI_SCHEMES = ['http', 'https', 'ftp'];
    protected const SAFE_LINK_SCHEMES = ['http', 'https', 'mailto', 'tel'];
    protected const SAFE_IMAGE_SCHEMES = ['http', 'https'];

    /**
     * @var DOMDocument
     */
    protected $xmlDocument;

    /**
     * @var array
     */
    protected $allowedTags = [];

    /**
     * @var array
     */
    protected $allowedAttrs = [];

    /**
     * @var array
     */
    protected $allowedCssProperties = [];

    /**
     * @var bool
     */
    protected $minifyXML = false;

    /**
     * @var bool
     */
    protected $removeRemoteReferences = false;

    /**
     * @var bool
     */
    protected $removeXMLTag = false;

    /**
     * @var int
     */
    protected $xmlOptions = LIBXML_NOEMPTYTAG;


    /**
     * SVGSanitizer::clean('<svg ...>')
     *
     * @param string $svgText
     * @return string|false
     */
    public static function clean($svgText) {

        $sanitizer = new static();

        return $sanitizer->sanitize($svgText);
    }

    /**
     * Sanitize an SVG file in place.
     *
     * @param string $path
     * @return bool
     */
    public static function sanitizeFile($path) {

        $dirty = @file_get_contents($path);

        if (!is_string($dirty)) {
            return false;
        }

        $sanitizer = new static();
        $sanitizer->removeRemoteReferences(true);

        $clean = $sanitizer->sanitize($dirty);

        if (!is_string($clean)) {
            return false;
        }

        return @file_put_contents($path, $clean) !== false;
    }

    /**
     *
     */
    public function __construct()
    {
        $this->allowedAttrs = $this->normalizeWhitelist([
            'accent-height', 'accumulate', 'additive', 'alignment-baseline', 'ascent',
            'attributename', 'attributetype', 'azimuth',
            'basefrequency', 'baseline-shift', 'begin', 'bias', 'by',
            'class', 'clip', 'clip-path', 'clip-rule', 'color', 'color-interpolation',
            'color-interpolation-filters', 'color-profile', 'color-rendering', 'crossorigin',
            'cx', 'cy',
            'd', 'dx', 'dy', 'diffuseconstant', 'direction', 'display', 'divisor', 'dur',
            'edgemode', 'elevation', 'end',
            'fill', 'fill-opacity', 'fill-rule', 'filter', 'filterunits', 'flood-color',
            'flood-opacity', 'font-family', 'font-size', 'font-size-adjust', 'font-stretch',
            'font-style', 'font-variant', 'font-weight', 'fx', 'fy',
            'g1', 'g2', 'glyph-name', 'glyphref', 'gradienttransform', 'gradientunits',
            'height', 'href',
            'id', 'image-rendering', 'in', 'in2',
            'k', 'k1', 'k2', 'k3', 'k4', 'kerning', 'keypoints', 'keysplines', 'keytimes',
            'kernelmatrix', 'kernelunitlength',
            'lang', 'lengthadjust', 'letter-spacing',
            'lighting-color', 'local',
            'marker-end', 'marker-mid', 'marker-start', 'markerheight', 'markerunits',
            'markerwidth', 'mask', 'mask-type', 'maskcontentunits', 'maskunits', 'media',
            'mode', 'name', 'numoctaves',
            'offset', 'opacity', 'operator', 'order', 'orient', 'orientation', 'origin',
            'overflow',
            'paint-order', 'path', 'pathlength', 'patterncontentunits', 'patterntransform',
            'patternunits', 'points', 'pointsatx', 'pointsaty', 'pointsatz',
            'preservealpha', 'preserveaspectratio', 'primitiveunits',
            'r', 'radius', 'refx', 'refy', 'repeatcount', 'repeatdur', 'restart', 'result',
            'role', 'rotate', 'rx', 'ry',
            'scale', 'seed', 'shape-rendering', 'specularconstant',
            'specularexponent', 'spreadmethod', 'startoffset', 'stddeviation',
            'stitchtiles', 'stop-color', 'stop-opacity', 'stroke', 'stroke-dasharray',
            'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
            'stroke-opacity', 'stroke-width', 'style', 'surfacescale',
            'systemlanguage',
            'tabindex', 'targetx', 'targety', 'text-anchor', 'text-decoration',
            'text-rendering', 'textlength', 'transform', 'type',
            'u1', 'u2', 'unicode',
            'values', 'viewbox', 'visibility', 'version', 'vert-adv-y', 'vert-origin-x',
            'vert-origin-y',
            'width', 'word-spacing', 'wrap', 'writing-mode',
            'x', 'x1', 'x2', 'xchannelselector',
            'xml:id', 'xml:lang', 'xml:space',
            'xlink:href', 'xlink:title',
            'xmlns', 'xmlns:xlink',
            'y', 'y1', 'y2', 'ychannelselector',
            'z', 'zoomandpan',
        ]);

        $this->allowedTags = $this->normalizeWhitelist([
            'a', 'altglyph', 'altglyphdef', 'altglyphitem', 'animate', 'animatecolor',
            'animatemotion', 'animatetransform',
            'circle', 'clippath',
            'defs', 'desc',
            'ellipse',
            'feblend', 'fecolormatrix', 'fecomponenttransfer', 'fecomposite',
            'feconvolvematrix', 'fediffuselighting', 'fedisplacementmap',
            'fedistantlight', 'feflood', 'fefunca', 'fefuncb', 'fefuncg', 'fefuncr',
            'fegaussianblur', 'feimage', 'femerge', 'femergenode', 'femorphology',
            'feoffset', 'fepointlight', 'fespecularlighting', 'fespotlight', 'fetile',
            'feturbulence',
            'filter', 'font',
            'g', 'glyph', 'glyphref',
            'hkern',
            'image',
            'line', 'lineargradient',
            'marker', 'mask', 'metadata', 'mpath',
            'path', 'pattern', 'polygon', 'polyline',
            'radialgradient', 'rect',
            'set', 'stop', 'style', 'switch', 'svg', 'symbol',
            'text', 'textpath', 'title', 'tref', 'tspan',
            'use',
            'view', 'vkern',
        ]);

        $this->allowedCssProperties = $this->normalizeWhitelist([
            'clip-path', 'clip-rule', 'color', 'direction', 'display', 'fill',
            'fill-opacity', 'fill-rule', 'filter', 'flood-color', 'flood-opacity',
            'font-family', 'font-size', 'font-size-adjust', 'font-stretch', 'font-style',
            'font-variant', 'font-weight', 'image-rendering', 'letter-spacing',
            'marker-end', 'marker-mid', 'marker-start', 'mask', 'opacity', 'overflow',
            'paint-order', 'shape-rendering', 'stop-color', 'stop-opacity', 'stroke',
            'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap',
            'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity', 'stroke-width',
            'text-anchor', 'text-decoration', 'text-rendering', 'visibility',
            'word-spacing', 'writing-mode',
        ]);
    }

    /**
     * Set up the DOMDocument
     */
    protected function resetInternal()
    {
        $this->xmlDocument = new DOMDocument();
        $this->xmlDocument->preserveWhiteSpace = false;
        $this->xmlDocument->strictErrorChecking = false;
        $this->xmlDocument->resolveExternals = false;
        $this->xmlDocument->substituteEntities = false;
        $this->xmlDocument->validateOnParse = false;
        $this->xmlDocument->formatOutput = !$this->minifyXML;
    }

    /**
     * Set XML options to use when saving XML
     * See: DOMDocument::saveXML
     *
     * @param int  $xmlOptions
     */
    public function setXMLOptions($xmlOptions)
    {
        $this->xmlOptions = $xmlOptions;
    }

     /**
     * Get XML options to use when saving XML
     * See: DOMDocument::saveXML
     *
     * @return int
     */
    public function getXMLOptions()
    {
       return $this->xmlOptions;
    }

    /**
     * Get the array of allowed tags
     *
     * @return array
     */
    public function getAllowedTags()
    {
        return $this->allowedTags;
    }

    /**
     * Set custom allowed tags
     *
     * @param array $allowedTags
     */
    public function setAllowedTags($allowedTags)
    {
        $this->allowedTags = $this->normalizeWhitelist($allowedTags);
    }

    /**
     * Get the array of allowed attributes
     *
     * @return array
     */
    public function getAllowedAttrs()
    {
        return $this->allowedAttrs;
    }

    /**
     * Set custom allowed attributes
     *
     * @param array $allowedAttrs
     */
    public function setAllowedAttrs($allowedAttrs)
    {
        $this->allowedAttrs = $this->normalizeWhitelist($allowedAttrs);
    }

    /**
     * Should we remove references to remote files?
     *
     * @param bool $removeRemoteRefs
     */
    public function removeRemoteReferences($removeRemoteRefs = false)
    {
        $this->removeRemoteReferences = (bool) $removeRemoteRefs;
    }

    /**
     * Sanitize the passed string
     *
     * @param string $dirty
     * @return string|false
     */
    public function sanitize($dirty)
    {
        if (!is_string($dirty) || trim($dirty) === '') {
            return '';
        }

        // Strip PHP tags before XML parsing.
        $dirty = preg_replace('/<\?(=|php)(.+?)\?>/is', '', $dirty);

        $this->resetInternal();
        $this->setUpBefore();

        $loaded = $this->xmlDocument->loadXML($dirty, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_COMPACT);

        $this->tearDownAfter();

        if (!$loaded || !$this->isSvgDocument()) {
            return false;
        }

        $this->stripUnsafeNodes($this->xmlDocument);

        if (!$this->isSvgDocument()) {
            return false;
        }

        $allElements = $this->xmlDocument->getElementsByTagName('*');

        $this->startClean($allElements);

        if (!$this->isSvgDocument()) {
            return false;
        }

        if ($this->removeXMLTag) {
            $clean = $this->xmlDocument->saveXML($this->xmlDocument->documentElement, $this->xmlOptions);
        } else {
            $clean = $this->xmlDocument->saveXML($this->xmlDocument, $this->xmlOptions);
        }

        if (!is_string($clean) || $clean === '') {
            return false;
        }

        if ($this->minifyXML) {
            $clean = preg_replace('/>\s+</', '><', $clean);
            $clean = trim((string) $clean);
        }

        return $clean;
    }

    /**
     * Set up libXML before we start
     */
    protected function setUpBefore()
    {

        libxml_use_internal_errors(true);
    }

    /**
     * Restore libXML state after parsing.
     */
    protected function tearDownAfter()
    {
        libxml_clear_errors();
    }

    /**
     * Start the cleaning with tags, then move onto attributes and CSS values.
     *
     * @param \DOMNodeList $elements
     */
    protected function startClean(\DOMNodeList $elements)
    {
        for ($i = $elements->length - 1; $i >= 0; $i--) {
            $currentElement = $elements->item($i);

            if (!$currentElement instanceof \DOMElement) {
                continue;
            }

            $tagName = $this->normalizeTagName($currentElement);

            if (!in_array($tagName, $this->allowedTags, true)) {
                $currentElement->parentNode?->removeChild($currentElement);
                continue;
            }

            $this->cleanAttributesOnWhitelist($currentElement);

            if ($tagName === 'style' && !$this->sanitizeStyleElement($currentElement)) {
                $currentElement->parentNode?->removeChild($currentElement);
                continue;
            }

            if ($tagName === 'use' && $this->isUseTagDirty($currentElement)) {
                $currentElement->parentNode?->removeChild($currentElement);
            }
        }
    }

    /**
     * Only allow attributes that are on the whitelist and sanitize their values.
     *
     * @param \DOMElement $element
     */
    protected function cleanAttributesOnWhitelist(\DOMElement $element)
    {
        for ($x = $element->attributes->length - 1; $x >= 0; $x--) {
            $attribute = $element->attributes->item($x);

            if (!$attribute instanceof \DOMAttr) {
                continue;
            }

            $attrName = $this->normalizeAttributeName($attribute);

            if (!$this->isAllowedAttribute($attrName)) {
                $element->removeAttributeNode($attribute);
                continue;
            }

            $cleanValue = $this->sanitizeAttributeValue($element, $attrName, $attribute->value);

            if ($cleanValue === null || $cleanValue === '') {
                $element->removeAttributeNode($attribute);
                continue;
            }

            if ($cleanValue !== $attribute->value) {
                $attribute->value = $cleanValue;
            }
        }
    }

    /**
     * Remove dangerous XML node types that are not represented in the element whitelist.
     *
     * @param \DOMNode $node
     */
    protected function stripUnsafeNodes(\DOMNode $node)
    {
        for ($i = $node->childNodes->length - 1; $i >= 0; $i--) {
            $child = $node->childNodes->item($i);

            if (!$child) {
                continue;
            }

            if (in_array($child->nodeType, [
                XML_PI_NODE,
                XML_COMMENT_NODE,
                XML_DOCUMENT_TYPE_NODE,
                XML_ENTITY_NODE,
                XML_ENTITY_REF_NODE,
            ], true)) {
                $node->removeChild($child);
                continue;
            }

            if ($child->hasChildNodes()) {
                $this->stripUnsafeNodes($child);
            }
        }
    }

    /**
     * Should we minify the output?
     *
     * @param bool $shouldMinify
     */
    public function minify($shouldMinify = false)
    {
        $this->minifyXML = (bool) $shouldMinify;
    }

    /**
     * Should we remove the XML tag in the header?
     *
     * @param bool $removeXMLTag
     */
    public function removeXMLTag($removeXMLTag = false)
    {
        $this->removeXMLTag = (bool) $removeXMLTag;
    }

    /**
     * Check to see if an attribute is an aria attribute or not
     *
     * @param string $attributeName
     * @return bool
     */
    protected function isAriaAttribute($attributeName)
    {
        return strpos($attributeName, 'aria-') === 0;
    }

    /**
     * Check to see if an attribute is a data attribute or not
     *
     * @param string $attributeName
     * @return bool
     */
    protected function isDataAttribute($attributeName)
    {
        return strpos($attributeName, 'data-') === 0;
    }

    /**
     * Make sure our use tag is only referencing internal resources.
     *
     * @param \DOMElement $element
     * @return bool
     */
    protected function isUseTagDirty(\DOMElement $element)
    {
        $xlink = $this->getNormalizedAttributeValue($element, 'xlink:href');
        $href = $this->getNormalizedAttributeValue($element, 'href');

        if ($xlink === null && $href === null) {
            return true;
        }

        if ($xlink !== null && !$this->isFragmentReference($this->normalizeUriForChecks($xlink))) {
            return true;
        }

        return $href !== null && !$this->isFragmentReference($this->normalizeUriForChecks($href));
    }

    /**
     * @param array $values
     * @return array
     */
    protected function normalizeWhitelist(array $values)
    {
        return array_values(array_unique(array_map('strtolower', $values)));
    }

    /**
     * @return bool
     */
    protected function isSvgDocument()
    {
        if (!$this->xmlDocument || !$this->xmlDocument->documentElement) {
            return false;
        }

        return $this->normalizeTagName($this->xmlDocument->documentElement) === 'svg';
    }

    /**
     * @param \DOMElement $element
     * @return string
     */
    protected function normalizeTagName(\DOMElement $element)
    {
        return strtolower((string) ($element->localName ?: $element->tagName));
    }

    /**
     * @param \DOMAttr $attribute
     * @return string
     */
    protected function normalizeAttributeName(\DOMAttr $attribute)
    {
        $localName = strtolower((string) ($attribute->localName ?: $attribute->name));

        if ($attribute->prefix) {
            return strtolower($attribute->prefix).':'.$localName;
        }

        return strtolower($attribute->name);
    }

    /**
     * @param string $attributeName
     * @return bool
     */
    protected function isAllowedAttribute($attributeName)
    {
        return in_array($attributeName, $this->allowedAttrs, true)
            || $this->isAriaAttribute($attributeName)
            || $this->isDataAttribute($attributeName)
            || $this->isNamespaceDeclarationAttribute($attributeName);
    }

    /**
     * @param string $attributeName
     * @return bool
     */
    protected function isNamespaceDeclarationAttribute($attributeName)
    {
        return $attributeName === 'xmlns' || strpos($attributeName, 'xmlns:') === 0;
    }

    /**
     * @param \DOMElement $element
     * @param string $attributeName
     * @param string $value
     * @return string|null
     */
    protected function sanitizeAttributeValue(\DOMElement $element, $attributeName, $value)
    {
        $value = trim($value);

        if ($value === '') {
            return null;
        }

        if ($attributeName === 'style') {
            $style = $this->sanitizeCssDeclarationList($value);
            return $style !== '' ? $style : null;
        }

        if ($this->isHrefAttribute($attributeName)) {
            return $this->sanitizeHrefValue($this->normalizeTagName($element), $value);
        }

        if ($this->isUrlBearingAttribute($attributeName)) {
            return $this->sanitizeUrlFunctionValue($value);
        }

        return $value;
    }

    /**
     * @param string $attributeName
     * @return bool
     */
    protected function isHrefAttribute($attributeName)
    {
        return in_array($attributeName, ['href', 'xlink:href'], true);
    }

    /**
     * @param string $attributeName
     * @return bool
     */
    protected function isUrlBearingAttribute($attributeName)
    {
        return in_array($attributeName, [
            'clip-path',
            'cursor',
            'fill',
            'filter',
            'marker-end',
            'marker-mid',
            'marker-start',
            'mask',
            'stroke',
        ], true);
    }

    /**
     * @param string $tagName
     * @param string $value
     * @return string|null
     */
    protected function sanitizeHrefValue($tagName, $value)
    {
        if ($tagName === 'a') {
            return $this->sanitizeLinkHref($value);
        }

        if (in_array($tagName, ['image', 'feimage'], true)) {
            return $this->sanitizeImageHref($value);
        }

        return $this->sanitizeInternalReference($value);
    }

    /**
     * @param string $value
     * @return string|null
     */
    protected function sanitizeLinkHref($value)
    {
        $normalized = $this->normalizeUriForChecks($value);

        if ($normalized === '') {
            return null;
        }

        if ($this->isFragmentReference($normalized)) {
            return trim($value);
        }

        if ($this->isAllowedDataImageUri($normalized)) {
            return null;
        }

        $scheme = $this->extractUriScheme($normalized);

        if ($scheme === null) {
            return trim($value);
        }

        return in_array($scheme, self::SAFE_LINK_SCHEMES, true) ? trim($value) : null;
    }

    /**
     * @param string $value
     * @return string|null
     */
    protected function sanitizeImageHref($value)
    {
        $normalized = $this->normalizeUriForChecks($value);

        if ($normalized === '') {
            return null;
        }

        if ($this->isFragmentReference($normalized) || $this->isAllowedDataImageUri($normalized)) {
            return trim($value);
        }

        $scheme = $this->extractUriScheme($normalized);

        if ($scheme !== null) {
            if (!in_array($scheme, self::SAFE_IMAGE_SCHEMES, true)) {
                return null;
            }

            if ($this->removeRemoteReferences && $this->isRemoteUri($normalized)) {
                return null;
            }
        } elseif (strpos($normalized, '//') === 0 && $this->removeRemoteReferences) {
            return null;
        }

        return trim($value);
    }

    /**
     * @param string $value
     * @return string|null
     */
    protected function sanitizeInternalReference($value)
    {
        $normalized = $this->normalizeUriForChecks($value);

        return $this->isFragmentReference($normalized) ? trim($value) : null;
    }

    /**
     * @param string $value
     * @return string
     */
    protected function normalizeUriForChecks($value)
    {
        $value = html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $value = preg_replace('/[\x00-\x20\x7f]+/u', '', $value);

        return strtolower((string) $value);
    }

    /**
     * @param string $value
     * @return string|null
     */
    protected function extractUriScheme($value)
    {
        if (preg_match('/^([a-z][a-z0-9+.-]*):/i', $value, $match) !== 1) {
            return null;
        }

        return strtolower($match[1]);
    }

    /**
     * @param string $value
     * @return bool
     */
    protected function isRemoteUri($value)
    {
        if (strpos($value, '//') === 0) {
            return true;
        }

        $scheme = $this->extractUriScheme($value);

        return $scheme !== null && in_array($scheme, self::REMOTE_URI_SCHEMES, true);
    }

    /**
     * @param string $value
     * @return bool
     */
    protected function isFragmentReference($value)
    {
        return strpos($value, '#') === 0;
    }

    /**
     * @param string $value
     * @return bool
     */
    protected function isAllowedDataImageUri($value)
    {
        return preg_match(self::ALLOWED_DATA_IMAGE_REGEX, $value) === 1;
    }

    /**
     * @param string $value
     * @return string|null
     */
    protected function sanitizeUrlFunctionValue($value)
    {
        $value = trim($this->decodeCssEscapes($this->stripCssComments($value)));

        if ($value === '' || $this->containsForbiddenCssToken($value)) {
            return null;
        }

        if (stripos($value, 'url(') === false) {
            return $value;
        }

        $invalid = false;

        $sanitized = preg_replace_callback('/url\(\s*([\'"]?)(.*?)\1\s*\)/i', function($matches) use (&$invalid) {
            $reference = trim($matches[2]);
            $normalized = $this->normalizeUriForChecks($reference);

            if (!$this->isFragmentReference($normalized)) {
                $invalid = true;
                return '';
            }

            return 'url('.$reference.')';
        }, $value);

        if ($invalid || !is_string($sanitized)) {
            return null;
        }

        return trim($sanitized);
    }

    /**
     * @param \DOMElement $element
     * @return bool
     */
    protected function sanitizeStyleElement(\DOMElement $element)
    {
        $css = '';

        foreach ($element->childNodes as $child) {
            if (in_array($child->nodeType, [XML_TEXT_NODE, XML_CDATA_SECTION_NODE], true)) {
                $css .= $child->nodeValue;
                continue;
            }

            return false;
        }

        $css = $this->sanitizeCssStylesheet($css);

        if ($css === '') {
            return false;
        }

        while ($element->firstChild) {
            $element->removeChild($element->firstChild);
        }

        $element->appendChild($element->ownerDocument->createTextNode($css));

        return true;
    }

    /**
     * @param string $css
     * @return string
     */
    protected function sanitizeCssStylesheet($css)
    {
        $css = trim($this->decodeCssEscapes($this->stripCssComments($css)));

        if ($css === '' || $this->containsForbiddenCssToken($css)) {
            return '';
        }

        $rules = preg_split('/}(?![^()]*\))/', $css);
        $cleanRules = [];

        foreach ($rules as $rule) {
            $rule = trim($rule);

            if ($rule === '' || !str_contains($rule, '{')) {
                continue;
            }

            [$selector, $declarations] = explode('{', $rule, 2);

            $selector = trim($selector);

            if ($selector === '' || strpos($selector, '@') !== false || !$this->isSafeCssSelector($selector)) {
                continue;
            }

            $cleanDeclarations = $this->sanitizeCssDeclarationList($declarations);

            if ($cleanDeclarations === '') {
                continue;
            }

            $cleanRules[] = $selector.' { '.$cleanDeclarations.'; }';
        }

        return implode($this->minifyXML ? '' : "\n", $cleanRules);
    }

    /**
     * @param string $style
     * @return string
     */
    protected function sanitizeCssDeclarationList($style)
    {
        $style = trim($this->decodeCssEscapes($this->stripCssComments($style)));

        if ($style === '' || $this->containsForbiddenCssToken($style)) {
            return '';
        }

        $parts = preg_split('/;(?![^()]*\))/', $style);
        $cleanDeclarations = [];

        foreach ($parts as $part) {
            $part = trim($part);

            if ($part === '' || !str_contains($part, ':')) {
                continue;
            }

            [$property, $value] = explode(':', $part, 2);

            $property = strtolower(trim($property));

            if (!in_array($property, $this->allowedCssProperties, true)) {
                continue;
            }

            $cleanValue = $this->sanitizeCssValue($value);

            if ($cleanValue === null || $cleanValue === '') {
                continue;
            }

            $cleanDeclarations[] = $property.': '.$cleanValue;
        }

        return implode('; ', $cleanDeclarations);
    }

    /**
     * @param string $value
     * @return string|null
     */
    protected function sanitizeCssValue($value)
    {
        $value = trim($this->decodeCssEscapes($this->stripCssComments($value)));

        if ($value === '' || $this->containsForbiddenCssToken($value)) {
            return null;
        }

        if (stripos($value, 'url(') !== false) {
            return $this->sanitizeUrlFunctionValue($value);
        }

        return $value;
    }

    /**
     * @param string $css
     * @return bool
     */
    protected function containsForbiddenCssToken($css)
    {
        return preg_match(self::FORBIDDEN_CSS_PATTERN, $css) === 1;
    }

    /**
     * @param string $css
     * @return string
     */
    protected function stripCssComments($css)
    {
        return preg_replace('!/\*.*?\*/!s', '', $css);
    }

    /**
     * @param string $value
     * @return string
     */
    protected function decodeCssEscapes($value)
    {
        return preg_replace_callback('/\\\\([0-9a-f]{1,6}\s?|.)/i', function($matches) {
            $escaped = $matches[1];

            if (preg_match('/^[0-9a-f]{1,6}\s?$/i', $escaped) === 1) {
                $codePoint = hexdec(trim($escaped));

                if ($codePoint <= 0 || $codePoint > 0x10FFFF) {
                    return '';
                }

                return html_entity_decode('&#'.$codePoint.';', ENT_QUOTES | ENT_HTML5, 'UTF-8');
            }

            return $escaped;
        }, $value);
    }

    /**
     * @param string $selector
     * @return bool
     */
    protected function isSafeCssSelector($selector)
    {
        return preg_match('/^[\s.#,:>\-\+\*\[\]\(\)="\'a-zA-Z0-9_|~\^$]+$/', $selector) === 1;
    }

    /**
     * @param \DOMElement $element
     * @param string $attributeName
     * @return string|null
     */
    protected function getNormalizedAttributeValue(\DOMElement $element, $attributeName)
    {
        foreach ($element->attributes as $attribute) {
            if ($attribute instanceof \DOMAttr && $this->normalizeAttributeName($attribute) === $attributeName) {
                return $attribute->value;
            }
        }

        return null;
    }
}
