import { CommentThreadStatus } from 'azure-devops-extension-api/Git';
import {
  ColumnSorting,
  ITableColumn,
  sortItems,
  SortOrder,
  Table,
} from 'azure-devops-ui/Table';
import { IFilterState } from 'azure-devops-ui/Utilities/Filter';
import { ArrayItemProvider } from 'azure-devops-ui/Utilities/Provider';
import * as React from 'react';
import { Settings } from '../SettingsPanel/SettingsPanel.models';
import { getColumnTemplate as getColumns } from './PullRequestTable.columns';
import { PullRequestTableItem } from './PullRequestTable.models';

const areArraysEqual = (arr1: any[], arr2: any[]): boolean => {
  if (arr1 == null || arr2 == null) {
    return false;
  }
  if (arr1.length !== arr2.length) {
    return false;
  }
  for (let i = arr1.length; i--; ) {
    if (arr1[i] !== arr2[i]) {
      return false;
    }
  }
  return true;
};

type SortFunction = (
  item1: PullRequestTableItem,
  item2: PullRequestTableItem
) => any;

const getSortFunctions = (settings: Settings): SortFunction[] => {
  let functionsResult: SortFunction[] = [];

  if (settings.AuthorColumnEnabled) {
    functionsResult.push((item1, item2) => {
      return item1.author.displayName.localeCompare(item2.author.displayName);
    });
  }

  if (settings.CreatedColumnEnabled) {
    functionsResult.push((item1, item2) => {
      return item1.creationDate < item2.creationDate;
    });
  }

  if (settings.DetailsColumnEnabled) {
    functionsResult.push((item1, item2) => {
      return item1.id - item2.id;
    });
  }

  if (settings.RepositoryColumnEnabled) {
    functionsResult.push((item1, item2) => {
      return item1.repo.name.localeCompare(item2.repo.name);
    });
  }

  if (settings.CommentsColumnEnabled) {
    functionsResult.push((item1, item2) => {
      return (
        item1.comments.length -
        item1.comments.filter((c) => c.status != CommentThreadStatus.Active)
          .length -
        (item2.comments.length -
          item2.comments.filter((c) => c.status != CommentThreadStatus.Active)
            .length)
      );
    });
  }

  if (settings.BuildStatusColumnEnabled) {
    functionsResult.push((item1, item2) => {
      return item1.buildDetails.status.message.localeCompare(
        item2.buildDetails.status.message
      );
    });
  }

  if (settings.MyVoteColumnEnabled) {
    functionsResult.push((item1, item2) => {
      return item1.vote.message.localeCompare(item2.vote.message);
    });
  }

  return functionsResult;
};

export interface PullRequestTableProps {
  items: ArrayItemProvider<PullRequestTableItem>;
  hostUrl: string;
  filter: IFilterState;
  settings: Settings;
  onSort: (items: PullRequestTableItem[]) => void;
}

export interface PullRequestTableState {
  columns: ITableColumn<PullRequestTableItem>[];
}

const PullRequestTable: React.FC<PullRequestTableProps> = (props) => {
  const { items, hostUrl, filter, settings, onSort } = props;

  const [state, setState] = React.useState<PullRequestTableState>({
    columns: getColumns(hostUrl, settings),
  });

  const sortBehavior = new ColumnSorting<PullRequestTableItem>(
    (columnIndex: number, proposedSortOrder: SortOrder) => {
      onSort(
        sortItems(
          columnIndex,
          proposedSortOrder,
          getSortFunctions(settings),
          state.columns,
          items.value
        )
      );
    }
  );

  return (
    <Table<PullRequestTableItem>
      ariaLabel="Pull request table"
      columns={state.columns}
      itemProvider={items}
      role="table"
      behaviors={[sortBehavior]}
    />
  );
};

export default PullRequestTable;
