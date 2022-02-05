import { IFilterState } from 'azure-devops-ui/Utilities/Filter';
import React from 'react';
import { PullRequestTable } from './PullRequestTable/PullRequestTable';
import {
  PullRequestTableItem,
  PullRequestTableProps,
} from './PullRequestTable/PullRequestTable.models';
import { Settings } from './SettingsPanel/SettingsPanel.models';

export enum TabType {
  Active = 'active',
  Drafts = 'drafts',
}

export interface TabContentsProps {
  selectedTabId: TabType;
  pullRequests: PullRequestTableItem[];
  userId: string;
  hostUrl: string;
  filter: IFilterState;
  settings: Settings;
}

export const TabContents: React.FC<TabContentsProps> = ({
  selectedTabId,
  pullRequests,
  ...props
}) => {
  const tableProps: PullRequestTableProps = {
    pullRequests:
      selectedTabId === TabType.Drafts
        ? pullRequests.filter(
            (pr) => pr.isDraft && pr.author.id === props.userId
          )
        : pullRequests.filter((pr) => !pr.isDraft),
    hostUrl: props.hostUrl,
    filter: props.filter,
    settings: props.settings,
  };

  return (
    <section className="page-content page-content-top">
      <PullRequestTable {...tableProps} />
    </section>
  );
};
