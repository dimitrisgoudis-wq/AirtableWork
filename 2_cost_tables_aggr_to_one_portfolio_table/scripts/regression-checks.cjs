const fs = require('fs');

const source = fs.readFileSync('frontend/index.js', 'utf8');
const styles = fs.readFileSync('frontend/style.css', 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function extract(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert(start >= 0 && end >= 0, `Could not locate ${startMarker}`);
    return source.slice(start, end);
}

const fieldHelpers = extract('const NUMERIC_FIELD_TYPES', 'function getFilterConditions');
const {isDropdownField, isSingleSelectResult, isDerivedDisplayField, shouldUseSelectPresentation, getFilterCapabilities, getFilterValueControl, configuredColumns} = new Function(`${fieldHelpers}; return {isDropdownField, isSingleSelectResult, isDerivedDisplayField, shouldUseSelectPresentation, getFilterCapabilities, getFilterValueControl, configuredColumns};`)();

assert(isDropdownField({type: 'multipleRecordLinks'}), 'Linked-record fields must use option controls');
assert(isDropdownField({type: 'singleSelect'}), 'Single-select fields must use option controls');
assert(isDropdownField({type: 'multipleSelects'}), 'Multiple-select fields must use option controls');
assert(isDropdownField({type: 'formula', options: {result: {type: 'singleSelect'}}}), 'Select-formatted formulas must use option controls');
assert(isDropdownField({type: 'lookup'}), 'Lookup fields must use option controls');
assert(isSingleSelectResult({type: 'lookup', options: {result: {type: 'singleSelect'}}}), 'Single-select lookup results must keep select presentation');
assert(isSingleSelectResult({type: 'formula', options: {formatting: {type: 'singleSelect'}}}), 'Select-formatted formulas must keep select presentation');
assert(!isSingleSelectResult({type: 'lookup', options: {result: {type: 'singleLineText'}}}), 'Text lookup results must not receive select presentation');
assert(isDerivedDisplayField({type: 'formula'}) && isDerivedDisplayField({type: 'lookup'}), 'Formula and lookup cells must inherit paired select presentation');
assert(!isDerivedDisplayField({type: 'singleLineText'}), 'Text cells must not inherit paired select presentation');
assert(shouldUseSelectPresentation({type: 'lookup'}, false), 'Lookup fields must always use select presentation');
assert(shouldUseSelectPresentation({type: 'formula'}, true), 'Formula fields must use paired select presentation');
assert(!shouldUseSelectPresentation({type: 'singleLineText'}, true), 'Text fields must not receive select presentation');
assert(!isDropdownField({type: 'singleLineText'}), 'Text fields must retain text controls');
assert(getFilterValueControl([{type: 'multipleRecordLinks'}]) === 'options', 'Linked-record filter must render option picker');
assert(getFilterValueControl([{type: 'singleLineText'}]) === 'text', 'Text-only filter must render text control');
const mixedCapabilities = getFilterCapabilities([{type: 'singleSelect'}, {type: 'singleLineText'}]);
assert(mixedCapabilities.options && mixedCapabilities.text, 'Mixed mappings must retain both option and text capabilities');
assert(getFilterValueControl([{type: 'singleSelect'}, {type: 'singleLineText'}]) === 'mixed', 'Mixed mappings must not be collapsed into one field type');
assert(getFilterValueControl([], [{value: [{id: 'recUnknown', name: 'Linked value'}]}]) === 'options', 'Linked-record values must retain option controls when field metadata is atypical');
const eligibleColumns = configuredColumns(
    [{key: 'mapped'}, {key: 'emptyHeader'}, {key: 'unmapped'}],
    {mapped: 'Mapped field', emptyHeader: '', unmapped: 'Placeholder'},
    column => column.key !== 'unmapped',
);
assert(eligibleColumns.map(column => column.key).join('|') === 'mapped', 'Unmapped or empty-header placeholders must not enter filter/group lists');
assert(source.includes('headers={headers}') && source.includes('{headers[item.key]}</option>'), 'Filter rules must display configured mapped headers');
assert(!source.includes('{item.defaultHeader}</option>'), 'Filter rules must not display placeholder field labels');
assert(styles.includes('.grid-viewport { flex: 1; min-height: 0; overflow: auto; }'), 'Grid viewport must fit available height');

const behaviorHelpers = extract('function textValue', 'let filterRuleSequence = 0;');
const {
    textValue,
    cellOptionLabels,
    filterValuesForColumn,
    aggregateColumns,
    getFilterCapabilities: getBehaviorCapabilities,
    getFilterConditions,
    matchesFilter,
} = new Function(`${behaviorHelpers}; return {textValue, cellOptionLabels, filterValuesForColumn, aggregateColumns, getFilterCapabilities, getFilterConditions, matchesFilter};`)();
const groupingHelper = extract('function formatGroupValue', 'function buildRows');
const {formatGroupValue, groupValueIdentity, createGroups} = new Function('textValue', 'cleanDropdownLabel', `${groupingHelper}; return {formatGroupValue, groupValueIdentity, createGroups};`)(textValue, value => String(value).trim());

const linkField = {type: 'multipleRecordLinks'};
const selectField = {type: 'singleSelect'};
const ddcLinkRow = {
    record: {getCellValueAsString: () => 'DDC Portfolio'},
    cells: {shared: {field: linkField, value: [{id: 'recDdc', name: 'DDC Portfolio'}]}},
};
const csSelectRow = {
    record: {getCellValueAsString: () => 'CS Programme'},
    cells: {shared: {field: selectField, value: {id: 'selCs', name: 'CS Programme'}}},
};
const csTextRow = {
    record: {getCellValueAsString: () => 'Free text from CS'},
    cells: {shared: {field: {type: 'singleLineText'}, value: 'Free text from CS'}},
};

assert(textValue(ddcLinkRow.cells.shared.value) === 'DDC Portfolio', 'Linked-record grid/CSV label is incorrect');
assert(textValue(csSelectRow.cells.shared.value) === 'CS Programme', 'Single-select grid/CSV label is incorrect');
assert(cellOptionLabels(ddcLinkRow, 'shared')[0] === 'DDC Portfolio', 'DDC linked-record option label is incorrect');
assert(cellOptionLabels(csSelectRow, 'shared')[0] === 'CS Programme', 'CS single-select option label is incorrect');
assert(getBehaviorCapabilities([], [ddcLinkRow.cells.shared]).options, 'Linked-record cell values must activate the option control even without metadata');
assert(filterValuesForColumn([ddcLinkRow, csSelectRow], 'shared').join('|') === 'CS Programme|DDC Portfolio', 'Merged option list must contain values from both sources');
assert(matchesFilter(ddcLinkRow, {columnKey: 'shared', condition: 'any', value: ['DDC Portfolio']}), 'DDC linked-record Any filter failed');
assert(!matchesFilter(csSelectRow, {columnKey: 'shared', condition: 'any', value: ['DDC Portfolio']}), 'CS single-select matched the wrong linked-record option');
assert(matchesFilter(csSelectRow, {columnKey: 'shared', condition: 'noMore', value: ['DDC Portfolio']}), 'CS single-select None of filter failed');
assert(matchesFilter(csTextRow, {columnKey: 'shared', condition: 'contains', value: 'text from'}), 'Text mapping in a mixed column lost Contains filtering');
const optionCapabilities = getBehaviorCapabilities([linkField, selectField]);
assert(optionCapabilities.options && !optionCapabilities.text, 'Two option mappings must stay option-only');
const mixedConditions = getFilterConditions(getBehaviorCapabilities([selectField, {type: 'singleLineText'}])).map(([value]) => value);
assert(mixedConditions.includes('any') && mixedConditions.includes('contains'), 'Mixed select/text mappings must offer both filter paths');
assert(formatGroupValue(ddcLinkRow, 'shared') === 'DDC Portfolio', 'Linked-record group label is incorrect');
assert(formatGroupValue(csSelectRow, 'shared') === 'CS Programme', 'Single-select group label is incorrect');
assert(source.includes('function GridCellValue') && (source.match(/<GridCellValue record=\{row\.record\} cell=\{cell\}/g) || []).length >= 2, 'Both grid panes must render the row\'s own mapped field');
const aggregateTestRows = [
    {cells: {mappedNumber: {value: 12.5}, mappedFormulaNumber: {value: 2}}},
    {cells: {mappedNumber: {value: 7.5}, mappedFormulaNumber: {value: 3}}},
];
const sumTotals = aggregateColumns(aggregateTestRows, new Set(['mappedNumber', 'mappedFormulaNumber']), {mappedNumber: 'sum', mappedFormulaNumber: 'sum'});
const maxTotals = aggregateColumns(aggregateTestRows, new Set(['mappedNumber', 'mappedFormulaNumber']), {mappedNumber: 'max', mappedFormulaNumber: 'max'});
const mixedTotals = aggregateColumns(aggregateTestRows, new Set(['mappedNumber', 'mappedFormulaNumber']), {mappedNumber: 'sum', mappedFormulaNumber: 'max'});
assert(sumTotals.mappedNumber === 20, 'Mapped numeric sum is incorrect');
assert(sumTotals.mappedFormulaNumber === 5, 'Mapped formula numeric sum is incorrect');
assert(maxTotals.mappedNumber === 12.5, 'Mapped numeric max is incorrect');
assert(maxTotals.mappedFormulaNumber === 3, 'Mapped formula numeric max is incorrect');
assert(mixedTotals.mappedNumber === 20 && mixedTotals.mappedFormulaNumber === 3, 'Each mapped numeric field must keep its own aggregation mode');
const negativeMax = aggregateColumns([
    {cells: {mappedNumber: {value: -12}}},
    {cells: {mappedNumber: {value: -3}}},
], new Set(['mappedNumber']), {mappedNumber: 'max'});
assert(negativeMax.mappedNumber === -3, 'Max aggregation must not turn negative group values into zero');
assert(source.includes("{key: aggregationKey(column), label: 'Aggregation enabled (On: Sum, Off: Max)'"), 'Aggregation mode must be exposed per field in extension settings');
assert(source.includes("propertyValues[aggregationKey(column)] === false ? 'max' : 'sum'"), 'Each field setting must initialize its own aggregation mode');
assert(!source.includes('AGGREGATION_ENABLED_KEY'), 'Global aggregation setting must not remain');
const groupedRows = [
    {cells: {group: {value: 'B'}}},
    {cells: {group: {value: null}}},
    {cells: {group: {value: 'Empty'}}},
    {cells: {group: {value: 'A'}}},
];
const groupsByIdentity = createGroups(groupedRows, 'group');
assert(groupsByIdentity.map(group => group.id).join('|') === 'value:A|value:B|value:Empty|empty', 'Groups must sort deterministically and keep blank values separate from the label Empty');
assert(groupsByIdentity.every(group => group.rows.length === 1), 'Blank and literal Empty values must not merge into one group');
assert(groupsByIdentity.find(group => group.id === 'empty').label === '(Empty)', 'Blank group labels must be visibly distinct from the value Empty');
assert(groupValueIdentity([{id: 'recOne', name: 'Duplicate name'}]) !== groupValueIdentity([{id: 'recTwo', name: 'Duplicate name'}]), 'Distinct linked records with the same display label must not merge');
const duplicateLabelGroups = createGroups([
    {cells: {group: {value: [{id: 'recOne', name: 'Duplicate name'}]}}},
    {cells: {group: {value: [{id: 'recTwo', name: 'Duplicate name'}]}}},
], 'group');
assert(duplicateLabelGroups.length === 2, 'Duplicate linked-record labels must remain separate groups');
assert(source.includes("{collapsed ? '▸' : '▾'}") && !source.includes('onToggle}>▾</button>'), 'Collapsed groups must show a consistent chevron state');
assert(source.includes('const firstColumnSubtotal = column && numericColumnKeys.has(column.key)'), 'Frozen numeric columns must include their group subtotal');
assert(source.includes("group.isEmpty ? !expandedEmptyGroupIds.has(group.id) : collapsedGroups.has(group.id)"), 'Empty groups must start collapsed');

const groupHelpers = extract('let filterRuleSequence = 0;', 'function formatGroupValue');
const {createFilterGroup, matchesFilterGroup} = new Function('matchesFilter', 'selectedFilterValues', `${groupHelpers}; return {createFilterGroup, matchesFilterGroup};`)((row, rule) => Boolean(row[rule.id]), value => (Array.isArray(value) ? value : [value]).filter(Boolean));
assert(Array.isArray(createFilterGroup().groups), 'New filter groups must include child-group storage');
const row = {yes: true, no: false};
assert(matchesFilterGroup(row, {operator: 'and', rules: [{id: 'yes', columnKey: 'x', condition: 'notEmpty'}, {id: 'no', columnKey: 'x', condition: 'notEmpty'}]}) === false, 'AND group behavior regressed');
assert(matchesFilterGroup(row, {operator: 'or', rules: [{id: 'yes', columnKey: 'x', condition: 'notEmpty'}, {id: 'no', columnKey: 'x', condition: 'notEmpty'}]}) === true, 'OR group behavior regressed');

// Audit reproductions: these failed before the fixes.
const numericRow = value => ({record: {getCellValueAsString: () => ''}, cells: {x: {value}}});
assert(aggregateColumns([numericRow([10, 20])], new Set(['x']), {}).x === 30, 'Numeric lookups must retain every value');
assert(aggregateColumns([numericRow(-10), numericRow(null)], new Set(['x']), {x: 'max'}).x === -10, 'Blank cells must not override negative maxima');
assert(!matchesFilter(numericRow(null), {columnKey: 'x', condition: 'lessThan', value: '5'}), 'Blank cells must not pass numeric comparisons');
assert(matchesFilter(numericRow(-1), {columnKey: 'x', condition: 'greaterThan', value: ''}), 'Blank numeric input must not act as zero');
const selectGroups = createGroups([numericRow({id: 'selA', name: 'Portfolio A'}), numericRow({id: 'selB', name: 'Portfolio A'})], 'x');
assert(selectGroups.length === 1 && selectGroups[0].rows.length === 2, 'Same select labels across sources must group together');
assert(!matchesFilterGroup(row, {operator: 'or', rules: [{id: 'no', columnKey: 'x', condition: 'notEmpty'}, {columnKey: ''}], groups: [{rules: [], groups: []}]}), 'Unfinished OR rules and empty groups must be ignored');
assert(matchesFilterGroup(row, {operator: 'and', rules: [{columnKey: 'x', condition: 'greaterThan', value: ''}]}), 'An unfinished numeric condition must be ignored');
const {getVisibleRange} = new Function('ROW_HEIGHT', extract('function getVisibleRange', 'function CostPortfolioGrid') + ';return {getVisibleRange};')(40);
for (const height of [400, 1000, 2000]) {
    const range = getVisibleRange(1200, height, 1000);
    assert(range.start * 40 <= 1200 && range.end * 40 >= 1200 + height, 'Rendered rows must cover the entire viewport');
}
const {getSelectedTable, getConfiguredField} = new Function(extract('function getSelectedTable', 'function getCustomProperties') + ';return {getSelectedTable,getConfiguredField};')();
const firstTable = {id: 'tblFirst'};
const base = {tables: [firstTable], getTableByIdIfExists: id => id === firstTable.id ? firstTable : null};
assert(getSelectedTable(base, undefined) === null && getSelectedTable(base, 'deleted') === null, 'Missing tables must never fall back to the first table');
assert(getSelectedTable(base, {id: 'tblFirst'}) === firstTable, 'Table model settings must resolve correctly');
const {enrichPortfolioRows} = new Function('COLUMNS', 'getConfiguredField', 'portfolioFieldKey', extract('function enrichPortfolioRows', 'function getVisibleRange') + ';return {enrichPortfolioRows};')([{key: 'x'}, {key: 'portfolioName'}], getConfiguredField, column => column.key + 'PortfolioField');
const link = {id: 'fldLink'};
const detail = {id: 'fldDetail'};
const table = {getFieldIfExists: id => id === link.id ? link : id === detail.id ? detail : null};
const portfolioRecord = {id: 'recPortfolio', getCellValue: () => 50};
const cost = {id: 'cost1', source: 'DDC', record: {getCellValue: () => [{id: 'recPortfolio', name: 'Portfolio A'}]}, cells: {x: {field: null, value: null}, portfolioName: {field: null, value: null}}};
const enriched = enrichPortfolioRows([cost, {...cost, id: 'cost2'}], {ddc: table, portfolio: table}, [portfolioRecord], {ddcPortfolioLink: link, xPortfolioField: detail});
assert(enriched.length === 2 && enriched[0].cells.x.record === portfolioRecord && enriched[0].cells.x.value === 50, 'Portfolio join must resolve the correct record without multiplying costs');
assert(aggregateColumns(enriched, new Set(['x']), {}).x === 50, 'Repeated portfolio details must count only once in totals');
assert(textValue(enriched[0].cells.portfolioName.value) === 'Portfolio A', 'Portfolio links must provide default portfolio labels');
console.log('Regression checks passed');
