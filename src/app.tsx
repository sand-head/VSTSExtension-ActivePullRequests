import * as API from "azure-devops-extension-api";
import { CommonServiceIds, IExtensionDataManager, IExtensionDataService, IProjectPageService } from "azure-devops-extension-api";
import { BuildReason, BuildRestClient, Build } from "azure-devops-extension-api/Build";
import { GitRepository, GitRestClient, PullRequestStatus } from "azure-devops-extension-api/Git";
import * as SDK from "azure-devops-extension-sdk";
import { IUserContext } from "azure-devops-extension-sdk";
import { ConditionalChildren } from "azure-devops-ui/ConditionalChildren";
import { ObservableValue } from "azure-devops-ui/Core/Observable";
import { DropdownFilterBarItem } from "azure-devops-ui/Dropdown";
import { FilterBar } from "azure-devops-ui/FilterBar";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { HeaderCommandBarWithFilter } from "azure-devops-ui/HeaderCommandBar";
import { Page } from "azure-devops-ui/Page";
import { Surface, SurfaceBackground } from "azure-devops-ui/Surface";
import { Tab, TabBar } from "azure-devops-ui/Tabs";
import { KeywordFilterBarItem } from "azure-devops-ui/TextFilterBarItem";
import { DropdownMultiSelection } from "azure-devops-ui/Utilities/DropdownSelection";
import { Filter, FILTER_CHANGE_EVENT, IFilter, IFilterState } from "azure-devops-ui/Utilities/Filter";
import * as React from "react";
import { useState } from "react";
import * as styles from "./app.scss";
import { useAzureDevOpsSDK } from "./hooks/DevOps";
import { PullRequestTable } from "./components/PullRequestTable/PullRequestTable";
import { getStatusFromBuild, getVoteStatus } from "./components/PullRequestTable/PullRequestTable.helpers";
import { PullRequestTableItem } from "./components/PullRequestTable/PullRequestTable.models";
import SettingsPanel from "./components/SettingsPanel/SettingsPanel";
import { Settings } from "./components/SettingsPanel/SettingsPanel.models";
import { TabContents, TabType } from "./components/TabContents";

export interface AppState {
  hostUrl?: string;
  pullRequests: PullRequestTableItem[];
  repositories: GitRepository[];
  selectedTabId: TabType;
  activePrBadge?: number;
  draftPrBadge?: number;
  filter: IFilterState;
  showSettings: boolean;
  settings?: Settings;
}

export const App: React.FunctionComponent = () => {
  const gitClient = API.getClient(GitRestClient);
  const buildClient = API.getClient(BuildRestClient);
  const filter = new Filter();
  const [state, setState] = useState<AppState>({
    hostUrl: undefined,
    showSettings: false,
    filter: {},
    repositories: [],
    pullRequests: [],
    selectedTabId: TabType.Active,
    activePrBadge: undefined,
    draftPrBadge: undefined,
    settings: undefined
  });
  const [userContext, setUserContext] = useState<IUserContext>();
  const [projectName, setProjectName] = useState<string>();
  const [dataManager, setDataManager] = useState<IExtensionDataManager>();

  const onSelectedTabChanged = (newTabId: string) => {
    if (state.hostUrl) {
      setState({ ...state, selectedTabId: newTabId as TabType });
    }
  };

  const getAllPullRequests = async (): Promise<PullRequestTableItem[]> => {
    const builds = await buildClient.getBuilds(projectName!, undefined, undefined, undefined, undefined, undefined, undefined, BuildReason.PullRequest) || [];
    const pullRequests: PullRequestTableItem[] = await getPullRequests(builds);
    while (pullRequests.length > 0 && pullRequests.length % 99 === 0) {
      const morePRs = await getPullRequests(builds, pullRequests.length);
      if (morePRs.length === 0) break;
      pullRequests.push(...morePRs);
    }
    return pullRequests;
  };

  const getPullRequests = async (builds: Build[], skip = 0): Promise<PullRequestTableItem[]> => {
    const prs = await gitClient.getPullRequestsByProject(projectName!, searchFilter, undefined, skip, 99);
    if (prs.length === 0) return [];
    return [
      ...await Promise.all(prs.map(async pr => {
        const currentUserReview = pr.reviewers.find(x => x.id === userContext?.id);
        const latestBuild = builds.find(x => x.triggerInfo["pr.number"] != null && x.triggerInfo["pr.number"] === pr.pullRequestId.toString());
        const comments = (await gitClient.getThreads(pr.repository.id, pr.pullRequestId)).filter(thread => !thread.isDeleted && thread.status);
        return {
          id: pr.pullRequestId,
          isDraft: pr.isDraft,
          author: pr.createdBy,
          creationDate: pr.creationDate,
          title: pr.title,
          repo: pr.repository,
          baseBranch: pr.sourceRefName.replace("refs/heads/", ""),
          targetBranch: pr.targetRefName.replace("refs/heads/", ""),
          vote: getVoteStatus(currentUserReview ? currentUserReview.vote : -1),
          buildDetails: {
            build: latestBuild,
            status: getStatusFromBuild(latestBuild)
          },
          reviewers: pr.reviewers,
          link: pr.url,
          comments: comments
        };
      }))
    ];
  }

  const getCurrentSettings = async (): Promise<Settings> => {
    var settingsResult = await dataManager?.getValue<string>(`${projectName}-extension-settings`, { scopeType: "User" });
    if (settingsResult && settingsResult !== "") {
      return JSON.parse(settingsResult);
    }

    // Default settings
    return {
      AuthorColumnEnabled: true,
      BuildStatusColumnEnabled: true,
      CommentsColumnEnabled: true,
      CreatedColumnEnabled: true,
      DetailsColumnEnabled: true,
      MyVoteColumnEnabled: true,
      RepositoryColumnEnabled: true,
      ReviewersColumnEnabled: true
    };
  }
  
  const stuff = useAzureDevOpsSDK(async () => {
    const extensionContext = SDK.getExtensionContext();
    console.log(`You're using version ${extensionContext.version} of All Active Pull Requests.`);
    const hostContext = SDK.getHost();
    setUserContext(SDK.getUser());
  
    const accessToken = await SDK.getAccessToken();
    const projectService = await SDK.getService<IProjectPageService>(CommonServiceIds.ProjectPageService);
    const extDataService = await SDK.getService<IExtensionDataService>(CommonServiceIds.ExtensionDataService);

    const project = await projectService.getProject();
    setProjectName(project?.name);
    setDataManager(await extDataService.getExtensionDataManager(SDK.getExtensionContext().id, accessToken));

    const settings = await getCurrentSettings();
    const repos = (await gitClient.getRepositories(projectName)).sort((a, b) => a.name.localeCompare(b.name));
    const pullRequests = await getAllPullRequests();

    const parentUrl = new URL(document.referrer);
    let baseUrl = parentUrl.origin;
    // the following base URL calculation was mostly done via trial-and-error:
    if (parentUrl.pathname.split('/')[1] === 'tfs') {
      baseUrl += `/tfs/${hostContext.name}/${projectName}`;
    } else if (parentUrl.hostname.endsWith('visualstudio.com')) {
      baseUrl += `/${projectName}`;
    } else {
      baseUrl += `/${hostContext.name}/${projectName}`;
    }
    console.debug('base URL', baseUrl);

    setState({
      ...state,
      hostUrl: baseUrl,
      settings: settings,
      repositories: repos,
      pullRequests: pullRequests.sort(this.defaultSortPrs),
      activePrBadge: pullRequests.filter(pr => !pr.isDraft).length,
      draftPrBadge: pullRequests.filter(pr => pr.isDraft && pr.author.id === userContext!.id).length
    });
  });

  return (
    <Surface background={SurfaceBackground.neutral}>
      <Page className={`flex-grow ${styles.fullHeight}`}>
        <Header title="All Repositories"
          titleSize={TitleSize.Large}
          commandBarItems={[]} />

        <TabBar selectedTabId={state.selectedTabId} onSelectedTabChanged={onSelectedTabChanged} renderAdditionalContent={this.renderTabBarCommands}>
          <Tab id={TabType.Active} name="Active Pull Requests" badgeCount={state.activePrBadge} />
          <Tab id={TabType.Drafts} name="My Drafts" badgeCount={state.draftPrBadge} />
        </TabBar>
        <ConditionalChildren renderChildren={this.showFilter}>
          <div className="page-content-left page-content-right page-content-top">
            <FilterBar filter={this.filter}>
              <KeywordFilterBarItem filterItemKey="keyword" />
              <DropdownFilterBarItem
                filterItemKey="repo"
                filter={this.filter}
                items={state.repositories.map(repo => {
                  return {
                    id: repo.id,
                    text: repo.name
                  };
                })}
                selection={this.repoFilterSelection}
                placeholder="Repositories" />
            </FilterBar>
          </div>
        </ConditionalChildren>
        <ConditionalChildren renderChildren={state.showSettings}>
          <SettingsPanel settings={state.settings!} dataManager={dataManager!} closeSettings={closeSettings} projectName={projectName!} />
        </ConditionalChildren>
        <TabContents {...state} userId={userContext!.id} />
      </Page>
    </Surface>
  );
};

export class App2 extends React.Component<{}, AppState> {
  private showFilter = new ObservableValue<boolean>(false);
  private projectName: string;
  private isReady: boolean = false;
  private dataManager: IExtensionDataManager;
  private gitClient: GitRestClient;
  private buildClient: BuildRestClient;
  private userContext: IUserContext;
  private filter: IFilter;
  private repoFilterSelection = new DropdownMultiSelection();
  private searchFilter: {
    creatorId: undefined,
    includeLinks: undefined,
    repositoryId: undefined,
    reviewerId: undefined,
    sourceRefName: undefined,
    sourceRepositoryId: undefined,
    status: PullRequestStatus.Active,
    targetRefName: undefined
  };

  constructor(props) {
    super(props);
    this.gitClient = API.getClient(GitRestClient);
    this.buildClient = API.getClient(BuildRestClient);
    this.filter = new Filter();
    this.state = {
      hostUrl: undefined,
      showSettings: false,
      filter: {},
      repositories: [],
      pullRequests: undefined,
      selectedTabId: TabType.Active,
      activePrBadge: undefined,
      draftPrBadge: undefined,
      settings: undefined
    };
    this.filter.subscribe(() => this.setState({ filter: this.filter.getState() }), FILTER_CHANGE_EVENT);
  }

  componentDidMount() {
    this.initialize();
  }

  closeSettings = () => {
    this.setState({ showSettings: false });
  }

  render() {
    return (<Surface background={SurfaceBackground.neutral}>
      <Page className={`flex-grow ${styles.fullHeight}`}>
        <Header title="All Repositories"
          titleSize={TitleSize.Large}
          commandBarItems={[]} />

        <TabBar selectedTabId={this.state.selectedTabId} onSelectedTabChanged={this.onSelectedTabChanged} renderAdditionalContent={this.renderTabBarCommands}>
          <Tab id={TabType.Active} name="Active Pull Requests" badgeCount={this.state.activePrBadge} />
          <Tab id={TabType.Drafts} name="My Drafts" badgeCount={this.state.draftPrBadge} />
        </TabBar>
        <ConditionalChildren renderChildren={this.showFilter}>
          <div className="page-content-left page-content-right page-content-top">
            <FilterBar filter={this.filter}>
              <KeywordFilterBarItem filterItemKey="keyword" />
              <DropdownFilterBarItem
                filterItemKey="repo"
                filter={this.filter}
                items={this.state.repositories.map(repo => {
                  return {
                    id: repo.id,
                    text: repo.name
                  };
                })}
                selection={this.repoFilterSelection}
                placeholder="Repositories" />
            </FilterBar>
          </div>
        </ConditionalChildren>
        <ConditionalChildren renderChildren={this.state.showSettings}>
          <SettingsPanel settings={this.state.settings} dataManager={this.dataManager} closeSettings={this.closeSettings} projectName={this.projectName} />
        </ConditionalChildren>
        {this.renderTabContents()}
      </Page>
    </Surface>);
  }

  private async initialize() {
    await SDK.ready();
    const extensionContext = SDK.getExtensionContext();
    console.log(`You're using version ${extensionContext.version} of All Active Pull Requests.`);

    const hostContext = SDK.getHost();
    this.userContext = SDK.getUser();
    const accessToken = await SDK.getAccessToken();
    const projectService = await SDK.getService<IProjectPageService>(CommonServiceIds.ProjectPageService);
    const extDataService = await SDK.getService<IExtensionDataService>(CommonServiceIds.ExtensionDataService);

    this.projectName = (await projectService.getProject()).name;
    this.dataManager = await extDataService.getExtensionDataManager(SDK.getExtensionContext().id, accessToken);
    const settings = await this.getCurrentSettings(this.projectName);
    const repos = (await this.gitClient.getRepositories(this.projectName)).sort((a, b) => a.name.localeCompare(b.name));
    const pullRequests = await this.getAllPullRequests(this.projectName);

    const parentUrl = new URL(document.referrer);
    let baseUrl = parentUrl.origin;
    if (parentUrl.pathname.split('/')[1] === 'tfs') {
      baseUrl += `/tfs/${hostContext.name}/${this.projectName}`;
    } else if (parentUrl.hostname.endsWith('visualstudio.com')) {
      baseUrl += `/${this.projectName}`;
    } else {
      baseUrl += `/${hostContext.name}/${this.projectName}`;
    }
    console.log('base URL', baseUrl);

    this.setState({
      hostUrl: baseUrl,
      settings: settings,
      repositories: repos,
      pullRequests: pullRequests.sort(this.defaultSortPrs),
      activePrBadge: pullRequests.filter(pr => !pr.isDraft).length,
      draftPrBadge: pullRequests.filter(pr => pr.isDraft && pr.author.id === this.userContext.id).length
    });
    this.isReady = true;
    await SDK.notifyLoadSucceeded();
  }

  private async getAllPullRequests(projectName: string): Promise<PullRequestTableItem[]> {
    const builds = await this.buildClient.getBuilds(projectName, null, null, null, null, null, null, BuildReason.PullRequest) || [];
    const pullRequests: PullRequestTableItem[] = await this.getPullRequests(projectName, builds);
    while (pullRequests.length > 0 && pullRequests.length % 99 === 0) {
      const morePRs = await this.getPullRequests(projectName, builds, pullRequests.length);
      if (morePRs.length === 0) break;
      pullRequests.push(...morePRs);
    }
    return pullRequests;
  }

  private async getPullRequests(projectName: string, builds: Build[], skip = 0): Promise<PullRequestTableItem[]> {
    const prs = await this.gitClient.getPullRequestsByProject(projectName, this.searchFilter, null, skip, 99);
    if (prs.length === 0) return [];
    return [
      ...await Promise.all(prs.map(async pr => {
        const currentUserReview = pr.reviewers.find(x => x.id === this.userContext.id);
        const latestBuild = builds.find(x => x.triggerInfo["pr.number"] != null && x.triggerInfo["pr.number"] === pr.pullRequestId.toString());
        const comments = (await this.gitClient.getThreads(pr.repository.id, pr.pullRequestId)).filter(thread => !thread.isDeleted && thread.status);
        return {
          id: pr.pullRequestId,
          isDraft: pr.isDraft,
          author: pr.createdBy,
          creationDate: pr.creationDate,
          title: pr.title,
          repo: pr.repository,
          baseBranch: pr.sourceRefName.replace("refs/heads/", ""),
          targetBranch: pr.targetRefName.replace("refs/heads/", ""),
          vote: getVoteStatus(currentUserReview ? currentUserReview.vote : -1),
          buildDetails: {
            build: latestBuild,
            status: getStatusFromBuild(latestBuild)
          },
          reviewers: pr.reviewers,
          link: pr.url,
          comments: comments
        };
      }))
    ];
  }

  private async getCurrentSettings(projectName: string): Promise<Settings> {
    var settingsResult = await this.dataManager.getValue<string>(`${projectName}-extension-settings`, { scopeType: "User" });
    if (settingsResult && settingsResult !== "") {
      return JSON.parse(settingsResult);
    }

    // Default settings
    return {
      AuthorColumnEnabled: true,
      BuildStatusColumnEnabled: true,
      CommentsColumnEnabled: true,
      CreatedColumnEnabled: true,
      DetailsColumnEnabled: true,
      MyVoteColumnEnabled: true,
      RepositoryColumnEnabled: true,
      ReviewersColumnEnabled: true
    };
  }

  private renderTabBarCommands = () => {
    return <HeaderCommandBarWithFilter filter={this.filter} filterToggled={this.showFilter} items={[
      {
        subtle: true,
        id: "settings",
        onActivate: () => {
          if (this.isReady) {
            this.setState({ showSettings: true });
          }
        },
        tooltipProps: { text: "Extension Settings" },
        disabled: false,
        iconProps: {
          iconName: "Settings"
        }
      },
    ]} />;
  }

  private onSelectedTabChanged = (newTabId: string) => {
    if (this.isReady) {
      this.setState({ selectedTabId: newTabId });
    }
  }

  private renderTabContents() {
    if (this.state.selectedTabId === TabType.Active) {
      return <section className="page-content page-content-top">
        <PullRequestTable pullRequests={
          this.state.pullRequests ? this.state.pullRequests.filter(x => !x.isDraft) : undefined
        } hostUrl={this.state.hostUrl} filter={this.state.filter} settings={this.state.settings} />
      </section>;
    } else if (this.state.selectedTabId === TabType.Drafts) {
      return <section className="page-content page-content-top">
        <PullRequestTable pullRequests={
          this.state.pullRequests ? this.state.pullRequests.filter(x => x.isDraft && x.author.id === this.userContext.id) : undefined
        } hostUrl={this.state.hostUrl} filter={this.state.filter} settings={this.state.settings} />
      </section>;
    }
    return <div></div>;
  }

  private defaultSortPrs(a: PullRequestTableItem, b: PullRequestTableItem) {
    if (a.id > b.id) {
      return 1;
    } else if (a.id < b.id) {
      return -1;
    }
    return 0;
  }
}