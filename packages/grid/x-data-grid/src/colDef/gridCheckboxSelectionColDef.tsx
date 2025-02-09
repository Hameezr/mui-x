import * as React from 'react';
import { GridCellCheckboxRenderer } from '../components/columnSelection/GridCellCheckboxRenderer';
import { GridHeaderCheckbox } from '../components/columnSelection/GridHeaderCheckbox';
import { selectedIdsLookupSelector } from '../hooks/features/selection/gridSelectionSelector';
import { GridColDef } from '../models/colDef/gridColDef';
import { GRID_BOOLEAN_COL_DEF } from './gridBooleanColDef';
import { GridValueGetterFullParams } from '../models/params/gridCellParams';

export const GRID_CHECKBOX_SELECTION_COL_DEF: GridColDef = {
  ...GRID_BOOLEAN_COL_DEF,
  field: '__check__',
  type: 'checkboxSelection',
  width: 50,
  resizable: false,
  sortable: false,
  filterable: false,
  disableColumnMenu: true,
  disableReorder: true,
  disableExport: true,
  valueGetter: (params) => {
    const selectionLookup = selectedIdsLookupSelector(
      (params as GridValueGetterFullParams).api.state,
      (params as GridValueGetterFullParams).api.instanceId,
    );
    return selectionLookup[params.id] !== undefined;
  },
  renderHeader: (params) => <GridHeaderCheckbox {...params} />,
  renderCell: (params) => <GridCellCheckboxRenderer {...params} />,
};
