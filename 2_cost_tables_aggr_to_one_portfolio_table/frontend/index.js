import {Component, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
    CellRenderer,
    initializeBlock,
    useBase,
    useCustomProperties,
    useGlobalConfig,
    useRecords,
} from '@airtable/blocks/interface/ui';
import './style.css';

const TABLE_KEYS = {ddc: 'ddcSourceTable', csCoe: 'csCoeSourceTable', portfolio: 'portfolioTable'};
const ROW_HEIGHT = 40;
const NUMERIC_COLUMN_KEYS = new Set([
    'plannedCosts',
    'totalPlannedCostsForDdc',
    'annualizedTraceWfhFte',
    'annualizedContractorFte',
    'annualizedInternalCsCoeFte',
]);
const COLUMNS = [
    ['costName', 'Cost Name'],
    ['portfolioName', 'Portfolio Name'],
    ['portfolioId', 'Portfolio ID'],
    ['investmentEvent', 'Investment Event'],
    ['investmentEventCategory', 'Investment Event Category'],
    ['plannedCosts', 'Planned Costs (CHF)'],
    ['totalPlannedCostsForDdc', 'Total Planned Costs for DDC'],
    ['annualizedTraceWfhFte', 'Annualized TRACE (WFH) FTE'],
    ['annualizedContractorFte', 'Annualized Contractor FTE'],
    ['annualizedInternalCsCoeFte', 'Annualized Internal CS CoE FTE'],
    ['portfolioItemCategory', 'Portfolio Item Category'],
    ['departmentGroup', 'Department Group'],
    ['additionalField13', 'Field 13'],
    ['additionalField14', 'Field 14'],
    ['additionalField15', 'Field 15'],
    ['additionalField16', 'Field 16'],
    ['additionalField17', 'Field 17'],
    ['additionalField18', 'Field 18'],
    ['additionalField19', 'Field 19'],
    ['additionalField20', 'Field 20'],
    ['additionalField21', 'Field 21'],
    ['additionalField22', 'Field 22'],
    ['additionalField23', 'Field 23'],
].map(([key, defaultHeader]) => ({key, defaultHeader, numeric: NUMERIC_COLUMN_KEYS.has(key)}));

const headerKey = column => `${column.key}Header`;
const ddcFieldKey = column => `${column.key}DdcField`;
const portfolioFieldKey = column => `${column.key}PortfolioField`;
const csCoeFieldKey = column => `${column.key}CsCoeField`;
const visibleKey = column => `${column.key}Visible`;
const topFilterKey = column => `${column.key}TopFilter`;
const aggregationKey = column => `${column.key}AggregationEnabled`;

function getSelectedTable(base, tableId) {
    const id = typeof tableId === 'string' ? tableId : tableId?.id;
    return id ? base.getTableByIdIfExists(id) : null;
}

function getConfiguredField(table, configuredField) {
    const fieldId = typeof configuredField === 'string' ? configuredField : configuredField?.id;
    return table && fieldId ? table.getFieldIfExists(fieldId) : null;
}

function getCustomProperties(base, tableIds) {
    const ddc = getSelectedTable(base, tableIds[TABLE_KEYS.ddc]);
    const csCoe = getSelectedTable(base, tableIds[TABLE_KEYS.csCoe]);
    const portfolio = getSelectedTable(base, tableIds[TABLE_KEYS.portfolio]);
    const fieldProperty = (key, label, table) => table ? [{key, label, type: 'field', table}] : [];
    const linkProperty = (key, label, table) => fieldProperty(key, label, table).map(property => ({
        ...property,
        shouldFieldBeAllowed: ({config}) => config.type === 'multipleRecordLinks' && config.options?.linkedTableId === portfolio?.id,
    }));
    return [
        {key: TABLE_KEYS.ddc, label: 'DDC source table', type: 'table'},
        {key: TABLE_KEYS.csCoe, label: 'CS CoE source table', type: 'table'},
        {key: TABLE_KEYS.portfolio, label: 'Portfolio table', type: 'table'},
        ...linkProperty('ddcPortfolioLink', 'DDC link to portfolio', ddc),
        ...linkProperty('csCoePortfolioLink', 'CS CoE link to portfolio', csCoe),
        ...COLUMNS.flatMap(column => [
            {key: headerKey(column), label: 'Header name', type: 'string', defaultValue: column.defaultHeader},
            ...fieldProperty(ddcFieldKey(column), 'Field DDC', ddc),
            ...fieldProperty(csCoeFieldKey(column), 'Field CS CoE', csCoe),
            ...fieldProperty(portfolioFieldKey(column), 'Portfolio field (fallback)', portfolio),
            {key: visibleKey(column), label: 'Show in grid', type: 'boolean', defaultValue: true},
            {key: topFilterKey(column), label: 'Show at top', type: 'boolean', defaultValue: false},
            {key: aggregationKey(column), label: 'Aggregation enabled (On: Sum, Off: Max)', type: 'boolean', defaultValue: true},
        ]),
    ];
}

function textValue(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(', ');
    if (typeof value === 'object') {
        const label = value.name ?? value.value ?? value.email ?? '';
        return typeof label === 'string' || typeof label === 'number' ? String(label) : '';
    }
    return String(value);
}

const INVISIBLE_AIRTABLE_CHARACTERS = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;

function cleanDropdownLabel(value) {
    return String(value)
        // Airtable display text can include invisible bidi/formatting characters.
        .replace(INVISIBLE_AIRTABLE_CHARACTERS, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function labelsFromValue(value) {
    if (Array.isArray(value)) return value.flatMap(labelsFromValue);
    const label = cleanDropdownLabel(textValue(value));
    return label && !/object object/i.test(label) ? [label] : [];
}

function cellOptionLabels(row, columnKey) {
    const cell = row.cells[columnKey];
    const labels = labelsFromValue(cell.value);
    // Prefer the clean record labels. Airtable's rendered text is only a fallback
    // for source fields that do not expose their raw linked/lookup labels.
    if (labels.length) return [...new Set(labels)];
    const displayText = cell.field ? cleanDropdownLabel((cell.record || row.record).getCellValueAsString(cell.field)) : '';
    const displayLabels = displayText
        ? displayText.split(',').map(cleanDropdownLabel).filter(Boolean)
        : [];
    return [...new Set(displayLabels)];
}

function filterValuesForColumn(rows, columnKey) {
    return [...new Set(rows.flatMap(row => cellOptionLabels(row, columnKey)))].sort(
        (left, right) => String(left).localeCompare(String(right), undefined, {numeric: true}),
    );
}

function selectedFilterValues(value) {
    return (Array.isArray(value) ? value : [value]).filter(Boolean);
}

function numericValues(value) {
    if (Array.isArray(value)) return value.flatMap(numericValues);
    if (value === null || value === undefined || typeof value === 'boolean') return [];
    if (typeof value === 'object') return numericValues(value.value ?? value.amount);
    if (typeof value === 'string' && !value.trim()) return [];
    const number = Number(value);
    return Number.isFinite(number) ? [number] : [];
}

function numericValue(value) {
    return numericValues(value).reduce((total, number) => total + number, 0);
}

const NUMERIC_FIELD_TYPES = new Set(['number', 'currency', 'percent', 'rating', 'duration', 'count', 'autoNumber']);

function effectiveFieldType(field) {
    const resultType = field?.options?.result?.type;
    return ['formula', 'rollup', 'lookup'].includes(field?.type) && resultType
        ? resultType
        : field?.type;
}

function isNumericField(field) {
    return NUMERIC_FIELD_TYPES.has(effectiveFieldType(field));
}

function formatAggregate(value) {
    return numericValue(value).toLocaleString(undefined, {maximumFractionDigits: 2});
}

function aggregateRows(rows, columnKey, aggregationMode) {
    const seen = new Set();
    const values = rows.flatMap(row => {
        const cell = row.cells[columnKey];
        if (!cell.contributions) return numericValues(cell.value);
        return cell.contributions.flatMap(contribution => {
            if (seen.has(contribution.id)) return [];
            seen.add(contribution.id);
            return numericValues(contribution.value);
        });
    });
    if (!values.length) return 0;
    return aggregationMode === 'max'
        ? values.reduce((maximum, value) => Math.max(maximum, value), Number.NEGATIVE_INFINITY)
        : values.reduce((total, value) => total + value, 0);
}

function aggregateColumns(rows, columnKeys, aggregationModes) {
    return Object.fromEntries([...columnKeys].map(columnKey => [
        columnKey,
        aggregateRows(rows, columnKey, aggregationModes[columnKey] || 'sum'),
    ]));
}

function isDropdownField(field) {
    return [
        'multipleRecordLinks',
        'singleSelect',
        'multipleSelects',
    ].includes(effectiveFieldType(field)) || field?.type === 'lookup';
}

function isSingleSelectResult(field) {
    const formattingType = field?.options?.formatting?.type || field?.options?.format?.type;
    return effectiveFieldType(field) === 'singleSelect' || formattingType === 'singleSelect';
}

function isDerivedDisplayField(field) {
    return ['formula', 'lookup', 'rollup'].includes(field?.type);
}

function shouldUseSelectPresentation(field, columnHasSingleSelect) {
    return field?.type === 'lookup' || (columnHasSingleSelect && isDerivedDisplayField(field));
}

function isOptionLikeCellValue(value) {
    if (Array.isArray(value)) return value.some(isOptionLikeCellValue);
    if (!value || typeof value !== 'object') return false;
    return typeof value.name === 'string' || typeof value.name === 'number';
}

function getFilterCapabilities(fields, cells = []) {
    const kinds = new Set(fields.filter(Boolean).map(field => {
        if (isNumericField(field)) return 'numeric';
        if (isDropdownField(field)) return 'options';
        return 'text';
    }));
    if (cells.some(cell => isOptionLikeCellValue(cell?.value))) kinds.add('options');
    return {
        numeric: kinds.has('numeric'),
        options: kinds.has('options'),
        text: kinds.has('text') || kinds.size === 0,
    };
}

function getFilterValueControl(fields, cells = []) {
    const capabilities = getFilterCapabilities(fields, cells);
    const availableKinds = ['numeric', 'options', 'text'].filter(kind => capabilities[kind]);
    return availableKinds.length === 1 ? availableKinds[0] : 'mixed';
}

function configuredColumns(columns, headers, isMapped) {
    return columns.filter(column => isMapped(column) && headers[column.key]?.trim());
}

function isOptionCondition(condition) {
    return condition === 'any' || condition === 'noMore';
}

function getFilterConditions(capabilities) {
    return [
        ...(capabilities.numeric ? [['greaterThan', 'Greater Than'], ['lessThan', 'Less Than']] : []),
        ...(capabilities.options ? [['any', 'Any'], ['noMore', 'None of']] : []),
        ...(capabilities.text ? [['contains', 'Contains'], ['doesNotContain', 'Does not contain']] : []),
        ['isEmpty', 'Is Empty'], ['notEmpty', 'Not Empty'],
    ];
}

function matchesFilter(row, filter) {
    if (!filter.columnKey) return true;
    const cell = row.cells[filter.columnKey];
    const optionLabels = cellOptionLabels(row, filter.columnKey);
    const isEmpty = cell.value === null || cell.value === undefined || optionLabels.length === 0;
    if (filter.condition === 'isEmpty') return isEmpty;
    if (filter.condition === 'notEmpty') return !isEmpty;
    if (filter.condition === 'greaterThan' || filter.condition === 'lessThan') {
        if (!String(filter.value ?? '').trim()) return true;
        const threshold = Number(filter.value);
        if (!Number.isFinite(threshold)) return true;
        if (!numericValues(cell.value).length) return false;
        return filter.condition === 'greaterThan'
            ? numericValue(cell.value) > threshold
            : numericValue(cell.value) < threshold;
    }
    const value = optionLabels.join(', ').toLocaleLowerCase();
    const selectedValues = (Array.isArray(filter.value) ? filter.value : [filter.value])
        .filter(Boolean)
        .map(selectedValue => selectedValue.toLocaleLowerCase());
    if (!selectedValues.length) return true;
    if (Array.isArray(filter.value)) {
        const includesAnySelectedValue = selectedValues.some(selectedValue => optionLabels
            .some(label => label.toLocaleLowerCase() === selectedValue));
        return filter.condition === 'noMore' ? !includesAnySelectedValue : includesAnySelectedValue;
    }
    const target = filter.value.toLocaleLowerCase();
    return ['noMore', 'doesNotContain'].includes(filter.condition)
        ? !value.includes(target)
        : value.includes(target);
}

let filterRuleSequence = 0;

function createFilterRule() {
    filterRuleSequence += 1;
    return {id: `rule-${filterRuleSequence}`, columnKey: '', condition: 'any', value: ''};
}

function createFilterGroup() {
    filterRuleSequence += 1;
    return {
        id: `group-${filterRuleSequence}`,
        operator: 'and',
        rules: [createFilterRule()],
        groups: [],
    };
}

function isActiveFilterRule(rule) {
    if (!rule.columnKey) return false;
    if (['isEmpty', 'notEmpty'].includes(rule.condition)) return true;
    if (['greaterThan', 'lessThan'].includes(rule.condition)) {
        return String(rule.value ?? '').trim() !== '' && Number.isFinite(Number(rule.value));
    }
    return selectedFilterValues(rule.value).some(value => String(value).trim() !== '');
}

function hasActiveFilterGroup(group) {
    return (group.rules || []).some(isActiveFilterRule) || (group.groups || []).some(hasActiveFilterGroup);
}

function matchesFilterGroup(row, group) {
    const results = [
        ...(group.rules || []).filter(isActiveFilterRule).map(rule => matchesFilter(row, rule)),
        ...(group.groups || []).filter(hasActiveFilterGroup).map(child => matchesFilterGroup(row, child)),
    ];
    if (!results.length) return true;
    return group.operator === 'or' ? results.some(Boolean) : results.every(Boolean);
}

function formatGroupValue(row, columnKey) {
    const value = textValue(row.cells[columnKey].value);
    return value || 'Empty';
}

function groupValueIdentity(value) {
    if (Array.isArray(value)) return `array:${JSON.stringify([...new Set(value.map(groupValueIdentity))].sort())}`;
    if (value && typeof value === 'object') {
        return value.id?.startsWith('rec') ? `id:${value.id}` : `value:${cleanDropdownLabel(textValue(value))}`;
    }
    return `value:${String(value)}`;
}

function groupIdentity(row, columnKey) {
    const rawValue = row.cells[columnKey].value;
    const value = textValue(rawValue);
    const label = formatGroupValue(row, columnKey);
    return value
        ? {id: groupValueIdentity(rawValue), label, isEmpty: false}
        : {id: 'empty', label: '(Empty)', isEmpty: true};
}

function createGroups(rows, columnKey) {
    const groupMap = new Map();
    rows.forEach(row => {
        const identity = groupIdentity(row, columnKey);
        const current = groupMap.get(identity.id) || {...identity, rows: []};
        current.rows.push(row);
        groupMap.set(identity.id, current);
    });
    return [...groupMap.values()].sort((left, right) => {
        if (left.isEmpty !== right.isEmpty) return left.isEmpty ? 1 : -1;
        const labelComparison = left.label.localeCompare(right.label, undefined, {numeric: true});
        return labelComparison || left.id.localeCompare(right.id, undefined, {numeric: true});
    });
}

function buildRows(records, source, table, columns, propertyValues) {
    return records.map(record => ({
        id: `${source}-${record.id}`,
        record,
        source,
        cells: Object.fromEntries(columns.map(column => {
            const configuredField = propertyValues[source === 'DDC' ? ddcFieldKey(column) : csCoeFieldKey(column)];
            const field = getConfiguredField(table, configuredField);
            const value = field ? record.getCellValue(field) : null;
            return [column.key, {field, value}];
        })),
    }));
}

function enrichPortfolioRows(rows, tables, portfolioRecords, propertyValues) {
    const portfolioById = new Map(portfolioRecords.map(record => [record.id, record]));
    return rows.map(row => {
        const table = row.source === 'DDC' ? tables.ddc : tables.csCoe;
        const linkKey = row.source === 'DDC' ? 'ddcPortfolioLink' : 'csCoePortfolioLink';
        const linkField = getConfiguredField(table, propertyValues[linkKey]);
        const links = linkField ? row.record.getCellValue(linkField) || [] : [];
        const linkedRecords = [...new Set(links.map(link => link.id))].map(id => portfolioById.get(id)).filter(Boolean);
        const cells = {...row.cells};
        COLUMNS.forEach(column => {
            if (cells[column.key].field) return;
            const field = getConfiguredField(tables.portfolio, propertyValues[portfolioFieldKey(column)]);
            if (field && linkedRecords.length === 1) {
                const record = linkedRecords[0];
                cells[column.key] = {field, value: record.getCellValue(field), record, contributions: [{id: `${record.id}:${field.id}`, value: record.getCellValue(field)}]};
            } else if (field && linkedRecords.length > 1) {
                cells[column.key] = {field: null, value: linkedRecords.map(record => record.getCellValue(field)), contributions: linkedRecords.map(record => ({id: `${record.id}:${field.id}`, value: record.getCellValue(field)}))};
            } else if (column.key === 'portfolioName' && links.length) {
                cells[column.key] = {field: null, value: links};
            }
        });
        return {...row, cells};
    });
}

function getVisibleRange(scrollTop, viewportHeight, entryCount) {
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 8);
    const end = Math.min(entryCount, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + 8);
    return {start, end};
}

function CostPortfolioGrid({tables, ddcRecords, csCoeRecords, portfolioRecords = [], propertyValues}) {
    const headers = useMemo(() => Object.fromEntries(COLUMNS.map(column => [
        column.key,
        propertyValues[headerKey(column)] ?? column.defaultHeader,
    ])), [propertyValues]);
    const aggregationModes = useMemo(() => Object.fromEntries(COLUMNS.map(column => [
        column.key,
        propertyValues[aggregationKey(column)] === false ? 'max' : 'sum',
    ])), [propertyValues]);
    const columnFields = useMemo(() => Object.fromEntries(COLUMNS.map(column => [
        column.key,
        getConfiguredField(tables.ddc, propertyValues[ddcFieldKey(column)]) ||
            getConfiguredField(tables.csCoe, propertyValues[csCoeFieldKey(column)]) ||
            getConfiguredField(tables.portfolio, propertyValues[portfolioFieldKey(column)]),
    ])), [propertyValues, tables.csCoe, tables.ddc, tables.portfolio]);
    const selectableColumns = useMemo(() => configuredColumns(COLUMNS, headers, column => (
        getConfiguredField(tables.ddc, propertyValues[ddcFieldKey(column)]) ||
        getConfiguredField(tables.csCoe, propertyValues[csCoeFieldKey(column)]) ||
        getConfiguredField(tables.portfolio, propertyValues[portfolioFieldKey(column)]) ||
        (column.key === 'portfolioName' && (propertyValues.ddcPortfolioLink || propertyValues.csCoePortfolioLink))
    )), [headers, propertyValues, tables.csCoe, tables.ddc, tables.portfolio]);
    const visibleColumns = useMemo(
        () => selectableColumns.filter(column => propertyValues[visibleKey(column)] !== false),
        [propertyValues, selectableColumns],
    );
    const topFilterColumns = useMemo(
        () => selectableColumns.filter(column => propertyValues[topFilterKey(column)] === true),
        [propertyValues, selectableColumns],
    );
    const rows = useMemo(() => enrichPortfolioRows([
        ...buildRows(ddcRecords, 'DDC', tables.ddc, COLUMNS, propertyValues),
        ...buildRows(csCoeRecords, 'CS CoE', tables.csCoe, COLUMNS, propertyValues),
    ], tables, portfolioRecords, propertyValues), [csCoeRecords, ddcRecords, portfolioRecords, propertyValues, tables]);

    const [filterOpen, setFilterOpen] = useState(false);
    const [filterExpression, setFilterExpression] = useState({operator: 'and', rules: [], groups: []});
    const [topFilters, setTopFilters] = useState({});
    const [openPickerId, setOpenPickerId] = useState('');
    const [topFilterSearches, setTopFilterSearches] = useState({});
    const [groupKey, setGroupKey] = useState(() => propertyValues.ddcPortfolioLink || propertyValues.csCoePortfolioLink ? 'portfolioName' : '');
    const [sort, setSort] = useState({columnKey: '', direction: 'asc'});
    const [collapsedGroups, setCollapsedGroups] = useState(new Set());
    const [expandedEmptyGroupIds, setExpandedEmptyGroupIds] = useState(new Set());
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [showSelectedOnly, setShowSelectedOnly] = useState(false);
    const [scrollTop, setScrollTop] = useState(0);
    const [widths, setWidths] = useState(() => Object.fromEntries(COLUMNS.map(column => [column.key, column.numeric ? 168 : 190])));
    const viewportRef = useRef(null);
    const footerScrollRef = useRef(null);
    const [viewportHeight, setViewportHeight] = useState(0);
    const [viewportOuterHeight, setViewportOuterHeight] = useState(0);
    useEffect(() => {
        const viewport = viewportRef.current;
        const measure = () => { setViewportHeight(viewport.clientHeight); setViewportOuterHeight(viewport.offsetHeight); };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(viewport);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const selectableKeys = new Set(selectableColumns.map(column => column.key));
        if (groupKey && !selectableKeys.has(groupKey)) setGroupKey('');
        if (sort.columnKey && !selectableKeys.has(sort.columnKey)) {
            setSort(current => ({...current, columnKey: ''}));
        }
    }, [groupKey, selectableColumns, sort.columnKey]);

    useEffect(() => {
        if (!openPickerId) return undefined;
        const closeOnOutsideClick = event => {
            if (!(event.target instanceof Element) || !event.target.closest('.filter-option-picker')) {
                setOpenPickerId('');
            }
        };
        document.addEventListener('mousedown', closeOnOutsideClick);
        return () => document.removeEventListener('mousedown', closeOnOutsideClick);
    }, [openPickerId]);

    const topFilterOptions = useMemo(() => Object.fromEntries(topFilterColumns.map(column => [
        column.key,
        filterValuesForColumn(rows, column.key),
    ])), [rows, topFilterColumns]);
    const topFilterDropdownKeys = useMemo(() => new Set(topFilterColumns.filter(column => getFilterCapabilities([
        getConfiguredField(tables.ddc, propertyValues[ddcFieldKey(column)]),
        getConfiguredField(tables.csCoe, propertyValues[csCoeFieldKey(column)]),
        getConfiguredField(tables.portfolio, propertyValues[portfolioFieldKey(column)]),
    ], rows.map(row => row.cells[column.key])).options).map(column => column.key)), [propertyValues, rows, tables.csCoe, tables.ddc, tables.portfolio, topFilterColumns]);
    const numericColumnKeys = useMemo(() => new Set(COLUMNS.filter(column => (
        column.numeric || isNumericField(getConfiguredField(tables.ddc, propertyValues[ddcFieldKey(column)])) ||
        isNumericField(getConfiguredField(tables.csCoe, propertyValues[csCoeFieldKey(column)])) ||
        isNumericField(getConfiguredField(tables.portfolio, propertyValues[portfolioFieldKey(column)]))
    )).map(column => column.key)), [propertyValues, tables.csCoe, tables.ddc, tables.portfolio]);
    const selectPresentationColumnKeys = useMemo(() => new Set(selectableColumns.filter(column => [
        getConfiguredField(tables.ddc, propertyValues[ddcFieldKey(column)]),
        getConfiguredField(tables.csCoe, propertyValues[csCoeFieldKey(column)]),
        getConfiguredField(tables.portfolio, propertyValues[portfolioFieldKey(column)]),
    ].some(isSingleSelectResult)).map(column => column.key)), [propertyValues, selectableColumns, tables.csCoe, tables.ddc, tables.portfolio]);
    const filteredRows = useMemo(() => rows.filter(row => (
        matchesFilterGroup(row, filterExpression) && topFilterColumns.every(column => (
            selectedFilterValues(topFilters[column.key]).length === 0 || selectedFilterValues(topFilters[column.key])
                .some(value => cellOptionLabels(row, column.key).includes(value))
        )) && (!showSelectedOnly || selectedIds.has(row.id))
    )), [filterExpression, rows, selectedIds, showSelectedOnly, topFilterColumns, topFilters]);
    const sortedRows = useMemo(() => [...filteredRows].sort((a, b) => {
        if (!sort.columnKey) return 0;
        const left = a.cells[sort.columnKey].value;
        const right = b.cells[sort.columnKey].value;
        const comparison = numericColumnKeys.has(sort.columnKey)
            ? numericValue(left) - numericValue(right)
            : textValue(left).localeCompare(textValue(right), undefined, {numeric: true});
        return sort.direction === 'asc' ? comparison : -comparison;
    }), [filteredRows, numericColumnKeys, sort]);
    const groups = useMemo(() => {
        if (!groupKey) return [{key: '', rows: sortedRows}];
        return createGroups(sortedRows, groupKey).map(group => ({...group, key: group.label}));
    }, [groupKey, sortedRows]);
    const entries = useMemo(() => groups.flatMap(group => {
        const groupEntry = groupKey ? [{type: 'group', group}] : [];
        const isCollapsed = group.isEmpty ? !expandedEmptyGroupIds.has(group.id) : collapsedGroups.has(group.id);
        return [...groupEntry, ...(isCollapsed ? [] : group.rows.map(row => ({type: 'row', row, group})))];
    }), [collapsedGroups, expandedEmptyGroupIds, groupKey, groups]);
    const totals = useMemo(
        () => aggregateColumns(filteredRows, numericColumnKeys, aggregationModes),
        [aggregationModes, filteredRows, numericColumnKeys],
    );
    const scrollColumns = visibleColumns.slice(1);
    const firstVisibleColumn = visibleColumns[0];
    const frozenPaneWidth = 44 + (firstVisibleColumn ? widths[firstVisibleColumn.key] : 0);
    const templateColumns = scrollColumns.map(column => `${widths[column.key]}px`).join(' ') || '1px';
    const gridWidth = scrollColumns.reduce((total, column) => total + widths[column.key], 0);
    const {start: firstVisible, end: lastVisible} = getVisibleRange(scrollTop, viewportHeight, entries.length);
    const visibleEntries = entries.slice(firstVisible, lastVisible);
    useEffect(() => {
        if (viewportRef.current) viewportRef.current.scrollTop = 0;
        setScrollTop(0);
    }, [filterExpression, topFilters, showSelectedOnly, groupKey, collapsedGroups, expandedEmptyGroupIds]);
    useEffect(() => {
        const viewport = viewportRef.current;
        const maximum = Math.max(0, ROW_HEIGHT + entries.length * ROW_HEIGHT - viewport.clientHeight);
        if (viewport.scrollTop > maximum) viewport.scrollTop = maximum;
        setScrollTop(viewport.scrollTop);
    }, [entries.length, viewportHeight]);

    function toggleSelected(id) {
        setSelectedIds(previous => {
            const next = new Set(previous);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    }
    function toggleGroup(group) {
        if (group.isEmpty) {
            setExpandedEmptyGroupIds(previous => {
                const next = new Set(previous);
                next.has(group.id) ? next.delete(group.id) : next.add(group.id);
                return next;
            });
            return;
        }
        setCollapsedGroups(previous => {
            const next = new Set(previous);
            next.has(group.id) ? next.delete(group.id) : next.add(group.id);
            return next;
        });
    }
    function toggleAll() {
        setSelectedIds(previous => {
            const next = new Set(previous);
            const allVisibleSelected = filteredRows.every(row => previous.has(row.id));
            filteredRows.forEach(row => allVisibleSelected ? next.delete(row.id) : next.add(row.id));
            return next;
        });
    }
    function resizeColumn(event, key) {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = widths[key];
        const onMove = moveEvent => setWidths(previous => ({
            ...previous,
            [key]: Math.max(110, startWidth + moveEvent.clientX - startX),
        }));
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }
    function exportCsv() {
        const csvRows = [
            ['Source', ...visibleColumns.map(column => headers[column.key])],
            ...groups.flatMap(group => group.rows.map(row => [
                row.source,
                ...visibleColumns.map(column => textValue(row.cells[column.key].value)),
            ])),
        ];
        const content = csvRows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
        const url = URL.createObjectURL(new Blob([content], {type: 'text/csv;charset=utf-8'}));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'portfolio-cost-grid.csv';
        link.click();
        URL.revokeObjectURL(url);
    }
    function updateRootRule(nextRule) {
        setFilterExpression(current => ({...current, rules: current.rules.map(rule => rule.id === nextRule.id ? nextRule : rule)}));
    }
    function updateFilterGroup(groupId, update) {
        setFilterExpression(current => ({...current, groups: current.groups.map(group => group.id === groupId ? update(group) : group)}));
    }
    return (
        <main className="grid-app">
            <div className="grid-toolbar">
                <strong>{filteredRows.length.toLocaleString()} records</strong>
                <button type="button" onClick={() => setFilterOpen(true)}>Filter</button>
                <label>Group <select value={groupKey} onChange={event => { setGroupKey(event.target.value); setCollapsedGroups(new Set()); setExpandedEmptyGroupIds(new Set()); }}><option value="">None</option>{selectableColumns.map(column => <option key={column.key} value={column.key}>{headers[column.key]}</option>)}</select></label>
                <label>Sort <select value={sort.columnKey} onChange={event => setSort(current => ({...current, columnKey: event.target.value}))}><option value="">None</option>{selectableColumns.map(column => <option key={column.key} value={column.key}>{headers[column.key]}</option>)}</select></label>
                {sort.columnKey && <button type="button" onClick={() => setSort(current => ({...current, direction: current.direction === 'asc' ? 'desc' : 'asc'}))}>{sort.direction === 'asc' ? '↑ Asc' : '↓ Desc'}</button>}
                <button className="toolbar-export" type="button" onClick={exportCsv}>Export CSV</button>
            </div>
            {topFilterColumns.length > 0 && <div className="top-filter-bar">
                {topFilterColumns.map(column => {
                    const selectedValues = selectedFilterValues(topFilters[column.key]);
                    const optionSearch = topFilterSearches[column.key] || '';
                    const visibleOptions = optionSearch.trim()
                        ? topFilterOptions[column.key].filter(value => value.toLocaleLowerCase().includes(optionSearch.trim().toLocaleLowerCase()))
                        : topFilterOptions[column.key];
                    return <div className="top-filter-chip" key={column.key}>
                        <span>{headers[column.key]}</span>
                        {topFilterDropdownKeys.has(column.key)
                            ? <details className="top-filter-picker filter-option-picker" open={openPickerId === `top:${column.key}`} onToggle={event => { const open = event.currentTarget.open; setOpenPickerId(current => open ? `top:${column.key}` : current === `top:${column.key}` ? '' : current); }}><summary>{selectedValues.length ? `${selectedValues.length} selected` : 'All'}</summary><div className="top-filter-options"><input className="filter-option-search" type="search" value={optionSearch} onChange={event => setTopFilterSearches(current => ({...current, [column.key]: event.target.value}))} placeholder="Search options" /><div className="top-filter-actions"><button type="button" onClick={() => setTopFilters(current => ({...current, [column.key]: topFilterOptions[column.key]}))}>Select all</button><button type="button" onClick={() => setTopFilters(current => ({...current, [column.key]: []}))}>Clear</button></div>{visibleOptions.map(value => <label key={value}><input type="checkbox" checked={selectedValues.includes(value)} onChange={() => setTopFilters(current => { const values = selectedFilterValues(current[column.key]); return {...current, [column.key]: values.includes(value) ? values.filter(selected => selected !== value) : [...values, value]}; })} />{value}</label>)}</div></details>
                            : <select value={topFilters[column.key] || ''} onChange={event => setTopFilters(current => ({...current, [column.key]: event.target.value}))}>
                                <option value="">All</option>
                                {topFilterOptions[column.key].map(value => <option key={value} value={value}>{value}</option>)}
                            </select>}
                    </div>;
                })}
            </div>}
            {filterOpen && <div className="filter-panel filter-builder">
                <label className="selected-rows-filter"><input type="checkbox" checked={showSelectedOnly} onChange={event => setShowSelectedOnly(event.target.checked)} />Show selected rows only</label>
                <label>Match <select value={filterExpression.operator} onChange={event => setFilterExpression(current => ({...current, operator: event.target.value}))}><option value="and">All conditions (AND)</option><option value="or">Any condition (OR)</option></select></label>
                {filterExpression.rules.map(rule => <FilterRuleEditor key={rule.id} rule={rule} columns={selectableColumns} headers={headers} rows={rows} tables={tables} propertyValues={propertyValues} onChange={updateRootRule} onRemove={() => setFilterExpression(current => ({...current, rules: current.rules.filter(item => item.id !== rule.id)}))} />)}
                {filterExpression.groups.map(group => (
                    <div className="filter-group" key={group.id}>
                        <label>Group match <select value={group.operator} onChange={event => updateFilterGroup(group.id, item => ({...item, operator: event.target.value}))}><option value="and">All (AND)</option><option value="or">Any (OR)</option></select></label>
                        {group.rules.map(rule => <FilterRuleEditor key={rule.id} rule={rule} columns={selectableColumns} headers={headers} rows={rows} tables={tables} propertyValues={propertyValues} onChange={nextRule => updateFilterGroup(group.id, item => ({...item, rules: item.rules.map(ruleItem => ruleItem.id === nextRule.id ? nextRule : ruleItem)}))} onRemove={() => updateFilterGroup(group.id, item => ({...item, rules: item.rules.filter(ruleItem => ruleItem.id !== rule.id)}))} />)}
                        <button type="button" onClick={() => updateFilterGroup(group.id, item => ({...item, rules: [...item.rules, createFilterRule()]}))}>Add condition</button>
                        <button type="button" onClick={() => setFilterExpression(current => ({...current, groups: current.groups.filter(item => item.id !== group.id)}))}>Remove group</button>
                    </div>
                ))}
                <button type="button" onClick={() => setFilterExpression(current => ({...current, rules: [...current.rules, createFilterRule()]}))}>Add filter</button>
                <button type="button" onClick={() => setFilterExpression(current => ({...current, groups: [...current.groups, createFilterGroup()]}))}>Add group</button>
                <button type="button" onClick={() => { setFilterExpression({operator: 'and', rules: [], groups: []}); setTopFilters({}); setShowSelectedOnly(false); }}>Clear all</button>
                <button type="button" onClick={() => setFilterOpen(false)}>Close</button>
            </div>}
            <div className="grid-shell" style={{gridTemplateColumns: `${frozenPaneWidth}px minmax(0, 1fr)`}}>
                <div className="frozen-grid-pane">
                    <div className="frozen-header-pane" style={{gridTemplateColumns: `44px ${firstVisibleColumn ? `${widths[firstVisibleColumn.key]}px` : '0px'}`}}>
                        <div className="grid-checkbox"><input type="checkbox" checked={filteredRows.length > 0 && filteredRows.every(row => selectedIds.has(row.id))} onChange={toggleAll} /></div>
                        {firstVisibleColumn && <div className="grid-header-cell" title={headers[firstVisibleColumn.key]}>{headers[firstVisibleColumn.key]}<span className="resize-handle" onMouseDown={event => resizeColumn(event, firstVisibleColumn.key)} /></div>}
                    </div>
                    <div className="frozen-body-pane" style={{height: Math.max(0, viewportOuterHeight - ROW_HEIGHT)}}>
                        <div style={{transform: `translateY(${firstVisible * ROW_HEIGHT - scrollTop}px)`}}>
                            {visibleEntries.map(entry => entry.type === 'group'
                                ? <FrozenGroupRow key={`frozen-group-${entry.group.id}`} group={entry.group} groupKey={groupKey} column={firstVisibleColumn} width={frozenPaneWidth} headers={headers} numericColumnKeys={numericColumnKeys} aggregationModes={aggregationModes} collapsed={entry.group.isEmpty ? !expandedEmptyGroupIds.has(entry.group.id) : collapsedGroups.has(entry.group.id)} onToggle={() => toggleGroup(entry.group)} />
                                : <FrozenDataRow key={`frozen-${entry.row.id}`} row={entry.row} column={firstVisibleColumn} width={frozenPaneWidth} columnFields={columnFields} selectPresentationColumnKeys={selectPresentationColumnKeys} selected={selectedIds.has(entry.row.id)} onToggle={() => toggleSelected(entry.row.id)} />,
                            )}
                        </div>
                    </div>
                    <div className="frozen-footer-pane" style={{gridTemplateColumns: `44px ${firstVisibleColumn ? `${widths[firstVisibleColumn.key]}px` : '0px'}`}}>
                        <div className="grid-total-label">Totals</div>
                        {firstVisibleColumn && <div className="grid-total-cell">{numericColumnKeys.has(firstVisibleColumn.key) ? formatAggregate(totals[firstVisibleColumn.key]) : ''}</div>}
                    </div>
                </div>
                <div className="scroll-grid-pane">
                    <div className="grid-viewport" ref={viewportRef} onScroll={event => {
                        setScrollTop(event.currentTarget.scrollTop);
                        if (footerScrollRef.current) footerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
                    }}>
                        <div style={{height: ROW_HEIGHT + entries.length * ROW_HEIGHT, position: 'relative', width: gridWidth}}>
                            <div className="grid-header" style={{gridTemplateColumns: templateColumns}}>
                                {scrollColumns.map(column => <div className="grid-header-cell" key={column.key} title={headers[column.key]}>{headers[column.key]}<span className="resize-handle" onMouseDown={event => resizeColumn(event, column.key)} /></div>)}
                            </div>
                            <div style={{height: entries.length * ROW_HEIGHT, position: 'relative'}}>
                                <div style={{position: 'absolute', top: firstVisible * ROW_HEIGHT, left: 0, width: gridWidth}}>
                                    {visibleEntries.map(entry => entry.type === 'group'
                                        ? <GroupRow key={`group-${entry.group.id}`} group={entry.group} columns={scrollColumns} templateColumns={templateColumns} numericColumnKeys={numericColumnKeys} aggregationModes={aggregationModes} />
                                        : <DataRow key={entry.row.id} row={entry.row} columns={scrollColumns} templateColumns={templateColumns} columnFields={columnFields} selectPresentationColumnKeys={selectPresentationColumnKeys} />,
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="grid-footer-scroll" ref={footerScrollRef}>
                        <div className="grid-footer" style={{gridTemplateColumns: templateColumns}}>
                            {scrollColumns.map(column => <div className="grid-total-cell" key={column.key}>{numericColumnKeys.has(column.key) ? formatAggregate(totals[column.key]) : ''}</div>)}
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
}

function GroupRow({group, columns, templateColumns, numericColumnKeys, aggregationModes}) {
    return <div className="group-row" style={{gridTemplateColumns: templateColumns}}>
        {columns.map(column => <div className="group-cell" key={column.key}>{numericColumnKeys.has(column.key) ? formatAggregate(aggregateRows(group.rows, column.key, aggregationModes[column.key] || 'sum')) : null}</div>)}
    </div>;
}

function GridCellValue({record, cell, fallback, useSelectPresentation}) {
    if (!cell.field) return cell.value === null || cell.value === undefined ? fallback : textValue(cell.value);
    return <div className={`cell-content${useSelectPresentation ? ' single-select-result-cell' : ''}`}><CellRenderer record={cell.record || record} field={cell.field} shouldWrap={false} /></div>;
}

function DataRow({row, columns, templateColumns, columnFields, selectPresentationColumnKeys}) {
    return <div className="grid-row" style={{gridTemplateColumns: templateColumns}}>
        {columns.map(column => {
            const cell = row.cells[column.key];
            const field = cell.field || columnFields[column.key];
            const fallback = '';
            const useSelectPresentation = shouldUseSelectPresentation(cell.field, selectPresentationColumnKeys.has(column.key));
            return <div className="grid-cell" key={column.key}><GridCellValue record={row.record} cell={cell} fallback={field ? fallback : ''} useSelectPresentation={useSelectPresentation} /></div>;
        })}
    </div>;
}

function FrozenGroupRow({group, groupKey, column, width, headers, numericColumnKeys, aggregationModes, collapsed, onToggle}) {
    const firstColumnSubtotal = column && numericColumnKeys.has(column.key)
        ? ` · ${formatAggregate(aggregateRows(group.rows, column.key, aggregationModes[column.key] || 'sum'))}`
        : '';
    return <div className="frozen-row frozen-group-row" style={{gridTemplateColumns: `44px ${Math.max(0, width - 44)}px`}}>
        <button className="group-title" type="button" onClick={onToggle}>{collapsed ? '▸' : '▾'}</button>
        {column && <div className="group-cell"><button type="button" onClick={onToggle}>{headers[groupKey]}: {group.key} ({group.rows.length}){firstColumnSubtotal}</button></div>}
    </div>;
}

function FrozenDataRow({row, column, width, columnFields, selectPresentationColumnKeys, selected, onToggle}) {
    if (!column) return <div className="frozen-row" style={{gridTemplateColumns: '44px'}}><div className="grid-checkbox"><input type="checkbox" checked={selected} onChange={onToggle} /></div></div>;
    const cell = row.cells[column.key];
    const field = cell.field || columnFields[column.key];
    const fallback = '';
    return <div className="frozen-row" style={{gridTemplateColumns: `44px ${Math.max(0, width - 44)}px`}}>
        <div className="grid-checkbox"><input type="checkbox" checked={selected} onChange={onToggle} /></div>
        <div className="grid-cell"><GridCellValue record={row.record} cell={cell} fallback={field ? fallback : ''} useSelectPresentation={shouldUseSelectPresentation(cell.field, selectPresentationColumnKeys.has(column.key))} /></div>
    </div>;
}

function OptionValuePicker({options, selectedValues, onChange}) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const pickerRef = useRef(null);
    const visibleOptions = search.trim()
        ? options.filter(value => value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
        : options;
    useEffect(() => {
        if (!isOpen) return undefined;
        const closeOnOutsideClick = event => {
            if (!pickerRef.current?.contains(event.target)) setIsOpen(false);
        };
        document.addEventListener('mousedown', closeOnOutsideClick);
        return () => document.removeEventListener('mousedown', closeOnOutsideClick);
    }, [isOpen]);
    return <details ref={pickerRef} className="rule-value-picker filter-option-picker" open={isOpen} onToggle={event => setIsOpen(event.currentTarget.open)}>
        <summary>{selectedValues.length ? `${selectedValues.length} selected` : 'Select options'}</summary>
        <div className="top-filter-options">
            <input className="filter-option-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search options" />
            <div className="top-filter-actions">
                <button type="button" onClick={() => onChange(options)}>Select all</button>
                <button type="button" onClick={() => onChange([])}>Clear</button>
            </div>
            {visibleOptions.map(value => <label key={value}><input type="checkbox" checked={selectedValues.includes(value)} onChange={() => onChange(selectedValues.includes(value) ? selectedValues.filter(selected => selected !== value) : [...selectedValues, value])} />{value}</label>)}
        </div>
    </details>;
}

function FilterRuleEditor({rule, columns, headers, rows, tables, propertyValues, onChange, onRemove}) {
    const column = columns.find(item => item.key === rule.columnKey);
    const sourceFields = column ? [
        getConfiguredField(tables.ddc, propertyValues[ddcFieldKey(column)]),
        getConfiguredField(tables.csCoe, propertyValues[csCoeFieldKey(column)]),
        getConfiguredField(tables.portfolio, propertyValues[portfolioFieldKey(column)]),
    ] : [];
    const sourceCells = column ? rows.map(row => row.cells[column.key]) : [];
    const capabilities = getFilterCapabilities(sourceFields, sourceCells);
    const options = column ? filterValuesForColumn(rows, column.key) : [];
    const conditions = getFilterConditions(capabilities);
    const selectedValues = selectedFilterValues(rule.value);
    function chooseColumn(columnKey) {
        const nextColumn = columns.find(item => item.key === columnKey);
        const nextFields = nextColumn ? [
            getConfiguredField(tables.ddc, propertyValues[ddcFieldKey(nextColumn)]),
            getConfiguredField(tables.csCoe, propertyValues[csCoeFieldKey(nextColumn)]),
            getConfiguredField(tables.portfolio, propertyValues[portfolioFieldKey(nextColumn)]),
        ] : [];
        const nextCells = nextColumn ? rows.map(row => row.cells[nextColumn.key]) : [];
        const nextCapabilities = getFilterCapabilities(nextFields, nextCells);
        const nextValueControl = getFilterValueControl(nextFields, nextCells);
        const defaultCondition = nextValueControl === 'numeric'
            ? 'greaterThan'
            : nextCapabilities.options
                ? 'any'
                : 'contains';
        onChange({
            ...rule,
            columnKey,
            condition: defaultCondition,
            value: isOptionCondition(defaultCondition) ? [] : '',
        });
    }
    function chooseCondition(condition) {
        const wasOptionCondition = isOptionCondition(rule.condition);
        const willUseOptions = isOptionCondition(condition);
        onChange({
            ...rule,
            condition,
            value: willUseOptions
                ? selectedValues
                : wasOptionCondition
                    ? selectedValues.join(', ')
                    : rule.value,
        });
    }
    return <div className="filter-rule">
        <select value={rule.columnKey} onChange={event => chooseColumn(event.target.value)}><option value="">Choose a field</option>{columns.map(item => <option key={item.key} value={item.key}>{headers[item.key]}</option>)}</select>
        {rule.columnKey && <select value={rule.condition} onChange={event => chooseCondition(event.target.value)}>{conditions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
        {rule.columnKey && !['isEmpty', 'notEmpty'].includes(rule.condition) && (isOptionCondition(rule.condition)
            ? <OptionValuePicker options={options} selectedValues={selectedValues} onChange={value => onChange({...rule, value})} />
            : <input type={['greaterThan', 'lessThan'].includes(rule.condition) ? 'number' : 'text'} value={rule.value} onChange={event => onChange({...rule, value: event.target.value})} placeholder="Value" />)}
        <button type="button" onClick={onRemove}>Remove</button>
    </div>;
}

function ExtensionApp({tableIds}) {
    const base = useBase();
    const properties = useCallback(configuredBase => getCustomProperties(configuredBase, tableIds), [tableIds]);
    const {customPropertyValueByKey, errorState} = useCustomProperties(properties);
    const tables = {
        ddc: getSelectedTable(base, customPropertyValueByKey[TABLE_KEYS.ddc]?.id),
        csCoe: getSelectedTable(base, customPropertyValueByKey[TABLE_KEYS.csCoe]?.id),
        portfolio: getSelectedTable(base, customPropertyValueByKey[TABLE_KEYS.portfolio]?.id),
    };
    if (errorState) return <div className="grid-error">Unable to load mappings: {errorState.error.message}</div>;
    if (!tables.ddc || !tables.csCoe) return <div className="grid-error">Select the DDC and CS CoE source tables in the interface settings.</div>;
    if (tables.ddc.id === tables.csCoe.id) return <div className="grid-error">Choose different DDC and CS CoE source tables to avoid duplicate costs.</div>;
    if (tableIds[TABLE_KEYS.portfolio] && !tables.portfolio) return <div className="grid-error">The selected portfolio table is unavailable. Select it again in the interface settings.</div>;
    for (const [key, table] of [['ddcPortfolioLink', tables.ddc], ['csCoePortfolioLink', tables.csCoe]]) {
        if (!customPropertyValueByKey[key]) continue;
        const field = getConfiguredField(table, customPropertyValueByKey[key]);
        if (!tables.portfolio || field?.type !== 'multipleRecordLinks' || field.options?.linkedTableId !== tables.portfolio.id) {
            return <div className="grid-error">Select a valid {key === 'ddcPortfolioLink' ? 'DDC' : 'CS CoE'} link to the portfolio table in the interface settings.</div>;
        }
    }
    return <SourceRecords key={JSON.stringify(Object.entries(customPropertyValueByKey).map(([key, value]) => [key, value?.id ?? value]))} tables={tables} propertyValues={customPropertyValueByKey} />;
}

function SourceRecords({tables, propertyValues}) {
    const ddcRecords = useRecords(tables.ddc);
    const csCoeRecords = useRecords(tables.csCoe);
    return tables.portfolio
        ? <PortfolioRecords tables={tables} ddcRecords={ddcRecords} csCoeRecords={csCoeRecords} propertyValues={propertyValues} />
        : <CostPortfolioGrid tables={tables} ddcRecords={ddcRecords} csCoeRecords={csCoeRecords} propertyValues={propertyValues} />;
}

function PortfolioRecords(props) {
    const portfolioRecords = useRecords(props.tables.portfolio);
    return <CostPortfolioGrid {...props} portfolioRecords={portfolioRecords} />;
}

function App() {
    const globalConfig = useGlobalConfig();
    const tableIds = Object.fromEntries(Object.values(TABLE_KEYS).map(key => [key, globalConfig.get(key)]));
    return <ExtensionApp key={Object.values(tableIds).join('|')} tableIds={tableIds} />;
}

class GridErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = {error: null};
    }

    static getDerivedStateFromError(error) {
        return {error};
    }

    componentDidCatch(error) {
        console.error('[Cost portfolio grid] runtime error', error);
    }

    render() {
        if (this.state.error) {
            return (
                <div className="grid-error">
                    The grid could not load: {this.state.error.message}
                </div>
            );
        }
        return this.props.children;
    }
}

initializeBlock({interface: () => <GridErrorBoundary><App /></GridErrorBoundary>});
