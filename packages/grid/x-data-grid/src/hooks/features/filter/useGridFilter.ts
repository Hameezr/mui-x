import * as React from 'react';
import { GridEventListener, GridEvents } from '../../../models/events';
import { DataGridProcessedProps } from '../../../models/props/DataGridProps';
import { GridApiCommunity } from '../../../models/api/gridApiCommunity';
import { GridFilterApi } from '../../../models/api/gridFilterApi';
import { GridFeatureModeConstant } from '../../../models/gridFeatureMode';
import { GridFilterItem } from '../../../models/gridFilterItem';
import { GridRowId, GridRowModel } from '../../../models/gridRows';
import { useGridApiEventHandler } from '../../utils/useGridApiEventHandler';
import { useGridApiMethod } from '../../utils/useGridApiMethod';
import { useGridLogger } from '../../utils/useGridLogger';
import { gridFilterableColumnLookupSelector } from '../columns/gridColumnsSelector';
import { GridPreferencePanelsValue } from '../preferencesPanel/gridPreferencePanelsValue';
import {
  getDefaultGridFilterModel,
  GridFilteringMethod,
  GridFilteringMethodCollection,
} from './gridFilterState';
import { gridFilterModelSelector, gridVisibleSortedRowEntriesSelector } from './gridFilterSelector';
import { useFirstRender } from '../../utils/useFirstRender';
import { gridRowIdsSelector, gridRowGroupingNameSelector } from '../rows';
import { GridPreProcessor, useGridRegisterPreProcessor } from '../../core/preProcessing';
import { useGridRegisterFilteringMethod } from './useGridRegisterFilteringMethod';
import {
  buildAggregatedFilterApplier,
  sanitizeFilterModel,
  mergeStateWithFilterModel,
} from './gridFilterUtils';
import { GridStateInitializer } from '../../utils/useGridInitializeState';

export const filterStateInitializer: GridStateInitializer<
  Pick<DataGridProcessedProps, 'filterModel' | 'initialState' | 'disableMultipleColumnsFiltering'>
> = (state, props, apiRef) => {
  const filterModel =
    props.filterModel ?? props.initialState?.filter?.filterModel ?? getDefaultGridFilterModel();

  return {
    ...state,
    filter: {
      filterModel: sanitizeFilterModel(filterModel, props.disableMultipleColumnsFiltering, apiRef),
      visibleRowsLookup: {},
      filteredDescendantCountLookup: {},
    },
  };
};

/**
 * @requires useGridColumns (method, event)
 * @requires useGridParamsApi (method)
 * @requires useGridRows (event)
 */
export const useGridFilter = (
  apiRef: React.MutableRefObject<GridApiCommunity>,
  props: Pick<
    DataGridProcessedProps,
    | 'initialState'
    | 'filterModel'
    | 'onFilterModelChange'
    | 'filterMode'
    | 'disableMultipleColumnsFiltering'
  >,
): void => {
  const logger = useGridLogger(apiRef, 'useGridFilter');
  const filteringMethodCollectionRef = React.useRef<GridFilteringMethodCollection>({});
  const lastFilteringMethodApplied = React.useRef<GridFilteringMethod | null>(null);

  apiRef.current.unstable_updateControlState({
    stateId: 'filter',
    propModel: props.filterModel,
    propOnChange: props.onFilterModelChange,
    stateSelector: gridFilterModelSelector,
    changeEvent: GridEvents.filterModelChange,
  });

  /**
   * API METHODS
   */
  const applyFilters = React.useCallback<GridFilterApi['unstable_applyFilters']>(() => {
    apiRef.current.setState((state) => {
      const rowGroupingName = gridRowGroupingNameSelector(state, apiRef.current.instanceId);
      const filteringMethod = filteringMethodCollectionRef.current[rowGroupingName];
      if (!filteringMethod) {
        throw new Error('MUI: Invalid filtering method.');
      }

      const filterModel = gridFilterModelSelector(state, apiRef.current.instanceId);
      const isRowMatchingFilters =
        props.filterMode === GridFeatureModeConstant.client
          ? buildAggregatedFilterApplier(filterModel, apiRef)
          : null;

      lastFilteringMethodApplied.current = filteringMethod;
      const filteringResult = filteringMethod({
        isRowMatchingFilters,
      });

      return {
        ...state,
        filter: {
          ...state.filter,
          ...filteringResult,
        },
      };
    });
    apiRef.current.publishEvent(GridEvents.visibleRowsSet);
    apiRef.current.forceUpdate();
  }, [apiRef, props.filterMode]);

  const upsertFilterItem = React.useCallback<GridFilterApi['upsertFilterItem']>(
    (item) => {
      const filterModel = gridFilterModelSelector(apiRef);
      const items = [...filterModel.items];
      const itemIndex = items.findIndex((filterItem) => filterItem.id === item.id);
      if (itemIndex === -1) {
        items.push(item);
      } else {
        items[itemIndex] = item;
      }
      apiRef.current.setFilterModel({ ...filterModel, items });
    },
    [apiRef],
  );

  const deleteFilterItem = React.useCallback<GridFilterApi['deleteFilterItem']>(
    (itemToDelete) => {
      const filterModel = gridFilterModelSelector(apiRef);
      const items = filterModel.items.filter((item) => item.id !== itemToDelete.id);

      if (items.length === filterModel.items.length) {
        return;
      }

      apiRef.current.setFilterModel({ ...filterModel, items });
    },
    [apiRef],
  );

  const showFilterPanel = React.useCallback<GridFilterApi['showFilterPanel']>(
    (targetColumnField) => {
      logger.debug('Displaying filter panel');
      if (targetColumnField) {
        const filterModel = gridFilterModelSelector(apiRef);
        const filterItemsWithValue = filterModel.items.filter((item) => item.value !== undefined);

        let newFilterItems: GridFilterItem[];
        const filterItemOnTarget = filterItemsWithValue.find(
          (item) => item.columnField === targetColumnField,
        );

        if (filterItemOnTarget) {
          newFilterItems = filterItemsWithValue;
        } else if (props.disableMultipleColumnsFiltering) {
          newFilterItems = [{ columnField: targetColumnField }];
        } else {
          newFilterItems = [...filterItemsWithValue, { columnField: targetColumnField }];
        }

        apiRef.current.setFilterModel({
          ...filterModel,
          items: newFilterItems,
        });
      }
      apiRef.current.showPreferences(GridPreferencePanelsValue.filters);
    },
    [apiRef, logger, props.disableMultipleColumnsFiltering],
  );

  const hideFilterPanel = React.useCallback<GridFilterApi['hideFilterPanel']>(() => {
    logger.debug('Hiding filter panel');
    apiRef.current.hidePreferences();
  }, [apiRef, logger]);

  const setFilterLinkOperator = React.useCallback<GridFilterApi['setFilterLinkOperator']>(
    (linkOperator) => {
      const filterModel = gridFilterModelSelector(apiRef);
      if (filterModel.linkOperator === linkOperator) {
        return;
      }
      apiRef.current.setFilterModel({
        ...filterModel,
        linkOperator,
      });
    },
    [apiRef],
  );

  const setFilterModel = React.useCallback<GridFilterApi['setFilterModel']>(
    (model) => {
      const currentModel = gridFilterModelSelector(apiRef);
      if (currentModel !== model) {
        logger.debug('Setting filter model');
        apiRef.current.setState(
          mergeStateWithFilterModel(model, props.disableMultipleColumnsFiltering, apiRef),
        );
        apiRef.current.unstable_applyFilters();
      }
    },
    [apiRef, logger, props.disableMultipleColumnsFiltering],
  );

  const getVisibleRowModels = React.useCallback<GridFilterApi['getVisibleRowModels']>(() => {
    const visibleSortedRows = gridVisibleSortedRowEntriesSelector(apiRef);
    return new Map<GridRowId, GridRowModel>(visibleSortedRows.map((row) => [row.id, row.model]));
  }, [apiRef]);

  const filterApi: GridFilterApi = {
    setFilterLinkOperator,
    unstable_applyFilters: applyFilters,
    deleteFilterItem,
    upsertFilterItem,
    setFilterModel,
    showFilterPanel,
    hideFilterPanel,
    getVisibleRowModels,
  };

  useGridApiMethod(apiRef, filterApi, 'GridFilterApi');

  /**
   * PRE-PROCESSING
   */
  const stateExportPreProcessing = React.useCallback<GridPreProcessor<'exportState'>>(
    (prevState) => {
      const filterModelToExport = gridFilterModelSelector(apiRef);
      if (
        filterModelToExport.items.length === 0 &&
        filterModelToExport.linkOperator === getDefaultGridFilterModel().linkOperator
      ) {
        return prevState;
      }

      return {
        ...prevState,
        filter: {
          filterModel: filterModelToExport,
        },
      };
    },
    [apiRef],
  );

  const stateRestorePreProcessing = React.useCallback<GridPreProcessor<'restoreState'>>(
    (params, context) => {
      const filterModel = context.stateToRestore.filter?.filterModel;
      if (filterModel == null) {
        return params;
      }
      apiRef.current.setState(
        mergeStateWithFilterModel(filterModel, props.disableMultipleColumnsFiltering, apiRef),
      );

      return {
        ...params,
        callbacks: [...params.callbacks, apiRef.current.unstable_applyFilters],
      };
    },
    [apiRef, props.disableMultipleColumnsFiltering],
  );

  const flatFilteringMethod = React.useCallback<GridFilteringMethod>(
    (params) => {
      if (props.filterMode === GridFeatureModeConstant.client && params.isRowMatchingFilters) {
        const rowIds = gridRowIdsSelector(apiRef);
        const filteredRowsLookup: Record<GridRowId, boolean> = {};
        for (let i = 0; i < rowIds.length; i += 1) {
          const rowId = rowIds[i];
          filteredRowsLookup[rowId] = params.isRowMatchingFilters(rowId);
        }
        return {
          filteredRowsLookup,
          // For flat tree, the `visibleRowsLookup` and the `filteredRowsLookup` since no row is collapsed.
          visibleRowsLookup: filteredRowsLookup,
          filteredDescendantCountLookup: {},
        };
      }

      return {
        visibleRowsLookup: {},
        filteredRowsLookup: {},
        filteredDescendantCountLookup: {},
      };
    },
    [apiRef, props.filterMode],
  );

  useGridRegisterPreProcessor(apiRef, 'exportState', stateExportPreProcessing);
  useGridRegisterPreProcessor(apiRef, 'restoreState', stateRestorePreProcessing);
  useGridRegisterFilteringMethod(apiRef, 'none', flatFilteringMethod);

  /**
   * EVENTS
   */
  const handleColumnsChange = React.useCallback<GridEventListener<GridEvents.columnsChange>>(() => {
    logger.debug('onColUpdated - GridColumns changed, applying filters');
    const filterModel = gridFilterModelSelector(apiRef);
    const filterableColumnsLookup = gridFilterableColumnLookupSelector(apiRef);
    const newFilterItems = filterModel.items.filter(
      (item) => item.columnField && filterableColumnsLookup[item.columnField],
    );
    if (newFilterItems.length < filterModel.items.length) {
      apiRef.current.setFilterModel({ ...filterModel, items: newFilterItems });
    }
  }, [apiRef, logger]);

  const handlePreProcessorRegister = React.useCallback<
    GridEventListener<GridEvents.preProcessorRegister>
  >(
    (name) => {
      if (name !== 'filteringMethod') {
        return;
      }

      filteringMethodCollectionRef.current = apiRef.current.unstable_applyPreProcessors(
        'filteringMethod',
        {},
      );

      const rowGroupingName = gridRowGroupingNameSelector(apiRef);
      if (
        lastFilteringMethodApplied.current !== filteringMethodCollectionRef.current[rowGroupingName]
      ) {
        apiRef.current.unstable_applyFilters();
      }
    },
    [apiRef],
  );

  useGridApiEventHandler(apiRef, GridEvents.rowsSet, apiRef.current.unstable_applyFilters);
  useGridApiEventHandler(
    apiRef,
    GridEvents.rowExpansionChange,
    apiRef.current.unstable_applyFilters,
  );
  useGridApiEventHandler(apiRef, GridEvents.columnsChange, handleColumnsChange);
  useGridApiEventHandler(apiRef, GridEvents.preProcessorRegister, handlePreProcessorRegister);

  /**
   * 1ST RENDER
   */
  useFirstRender(() => {
    // This line of pre-processor initialization should always come after the registration of `flatFilteringMethod`
    // Otherwise on the 1st render there would be no filtering method registered
    filteringMethodCollectionRef.current = apiRef.current.unstable_applyPreProcessors(
      'filteringMethod',
      {},
    );
    apiRef.current.unstable_applyFilters();
  });

  /**
   * EFFECTS
   */
  React.useEffect(() => {
    if (props.filterModel !== undefined) {
      apiRef.current.setFilterModel(props.filterModel);
    }
  }, [apiRef, logger, props.filterModel]);
};
