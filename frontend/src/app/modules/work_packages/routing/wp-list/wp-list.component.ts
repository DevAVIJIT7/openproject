// -- copyright
// OpenProject is an open source project management software.
// Copyright (C) 2012-2020 the OpenProject GmbH
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 3.
//
// OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
// Copyright (C) 2006-2013 Jean-Philippe Lang
// Copyright (C) 2010-2013 the ChiliProject Team
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
//
// See docs/COPYRIGHT.rdoc for more details.
// ++

import {ChangeDetectionStrategy, Component, OnDestroy} from "@angular/core";
import {untilComponentDestroyed} from 'ng2-rx-componentdestroyed';
import {QueryResource} from 'core-app/modules/hal/resources/query-resource';
import {OpTitleService} from "core-components/html/op-title.service";
import {WorkPackagesViewBase} from "core-app/modules/work_packages/routing/wp-view-base/work-packages-view.base";
import {take} from "rxjs/operators";
import {CausedUpdatesService} from "core-app/modules/boards/board/caused-updates/caused-updates.service";
import {DragAndDropService} from "core-app/modules/common/drag-and-drop/drag-and-drop.service";
import {BcfDetectorService} from "core-app/modules/bcf/helper/bcf-detector.service";
import {wpDisplayCardRepresentation} from "core-app/modules/work_packages/routing/wp-view-base/view-services/wp-view-display-representation.service";
import {WorkPackageTableConfigurationObject} from "core-components/wp-table/wp-table-configuration";
import {HalResourceNotificationService} from "core-app/modules/hal/services/hal-resource-notification.service";
import {WorkPackageNotificationService} from "core-app/modules/work_packages/notifications/work-package-notification.service";
import {QueryParamListenerService} from "core-components/wp-query/query-param-listener.service";
import {InjectField} from "core-app/helpers/angular/inject-field.decorator";

@Component({
  selector: 'wp-list',
  templateUrl: './wp.list.component.html',
  styleUrls: ['./wp-list.component.sass'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    /** We need to provide the wpNotification service here to get correct save notifications for WP resources */
    {provide: HalResourceNotificationService, useClass: WorkPackageNotificationService},
    DragAndDropService,
    CausedUpdatesService,
    QueryParamListenerService
  ]
})
export class WorkPackagesListComponent extends WorkPackagesViewBase implements OnDestroy {
  @InjectField() titleService:OpTitleService;
  @InjectField() bcfDetectorService:BcfDetectorService;
  @InjectField() queryParamListener:QueryParamListenerService;

  text = {
    'jump_to_pagination': this.I18n.t('js.work_packages.jump_marks.pagination'),
    'text_jump_to_pagination': this.I18n.t('js.work_packages.jump_marks.label_pagination'),
    'button_settings': this.I18n.t('js.button_settings')
  };

  /** Whether the title can be edited */
  titleEditingEnabled:boolean;

  /** Current query title to render */
  selectedTitle?:string;
  currentQuery:QueryResource;

  /** Whether we're saving the query */
  querySaving:boolean;

  /** Do we currently have query props ? */
  hasQueryProps:boolean;

  /** Listener callbacks */
  unRegisterTitleListener:Function;
  removeTransitionSubscription:Function;

  /** Determine when query is initially loaded */
  tableInformationLoaded = false;

  /** An overlay over the table shown for example when the filters are invalid */
  showResultOverlay = false;

  /** Switch between list and card view */
  private _showListView:boolean = true;

  public readonly wpTableConfiguration:WorkPackageTableConfigurationObject = {
    dragAndDropEnabled: true
  };

  ngOnInit() {
    super.ngOnInit();

    this.hasQueryProps = !!this.$state.params.query_props;
    this.removeTransitionSubscription = this.$transitions.onSuccess({}, (transition):any => {
      const params = transition.params('to');
      this.hasQueryProps = !!params.query_props;
    });

    // If the query was loaded, reload invisibly
    const isFirstLoad = !this.querySpace.initialized.hasValue();
    this.refresh(isFirstLoad, isFirstLoad);

    // Load query on URL transitions
    this.queryParamListener
      .observe$
      .pipe(
        untilComponentDestroyed(this)
      ).subscribe(() => {
        this.refresh(true, true);
      });

    // Mark tableInformationLoaded when initially loading done
    this.setupInformationLoadedListener();

    // Update title on entering this state
    this.unRegisterTitleListener = this.$transitions.onSuccess({to: 'work-packages.list'}, () => {
      if (this.selectedTitle) {
        this.titleService.setFirstPart(this.selectedTitle);
      }
    });

    this.querySpace.query.values$().pipe(
      untilComponentDestroyed(this)
    ).subscribe((query) => {
      // Update the title whenever the query changes
      this.updateTitle(query);
      this.currentQuery = query;

      // Update the visible representation
      if (this.deviceService.isMobile || this.wpDisplayRepresentation.valueFromQuery(query) === wpDisplayCardRepresentation) {
        this.showListView = false;
      } else {
        this.showListView = true;
      }

      this.cdRef.detectChanges();
    });
  }

  ngOnDestroy():void {
    super.ngOnDestroy();
    this.unRegisterTitleListener();
    this.removeTransitionSubscription();
    this.queryParamListener.removeQueryChangeListener();
  }

  public setAnchorToNextElement() {
    // Skip to next when visible, otherwise skip to previous
    const selectors = '#pagination--next-link, #pagination--prev-link, #pagination-empty-text';
    const visibleLink = jQuery(selectors)
      .not(':hidden')
      .first();

    if (visibleLink.length) {
      visibleLink.focus();
    }
  }

  public allowed(model:string, permission:string) {
    return this.authorisationService.can(model, permission);
  }

  public saveQueryFromTitle(val:string) {
    if (this.currentQuery && this.currentQuery.persisted) {
      this.updateQueryName(val);
    } else {
      this.wpListService
        .create(this.currentQuery, val)
        .then(() => this.querySaving = false)
        .catch(() => this.querySaving = false);
    }
  }

  updateQueryName(val:string) {
    this.querySaving = true;
    this.currentQuery.name = val;
    this.wpListService.save(this.currentQuery)
      .then(() => this.querySaving = false)
      .catch(() => this.querySaving = false);
  }


  updateTitle(query:QueryResource) {
    if (query.persisted) {
      this.selectedTitle = query.name;
    } else {
      this.selectedTitle = this.wpStaticQueries.getStaticName(query);
    }

    this.titleEditingEnabled = this.authorisationService.can('query', 'updateImmediately');

    // Update the title if we're in the list state alone
    if (this.$state.current.name === 'work-packages.list') {
      this.titleService.setFirstPart(this.selectedTitle);
    }
  }

  public refresh(visibly:boolean = false, firstPage:boolean = false):Promise<unknown> {
    let promise:Promise<unknown>;

    if (firstPage) {
      promise = this.wpListService.loadCurrentQueryFromParams(this.projectIdentifier);
    } else {
      promise = this.wpListService.reloadCurrentResultsList();
    }

    if (visibly) {
      this.loadingIndicator = promise.then(() => {
        if (this.wpTableTimeline.isVisible) {
          return this.querySpace.timelineRendered.pipe(take(1)).toPromise();
        } else {
          return this.querySpace.tableRendered.valuesPromise() as Promise<unknown>;
        }
      });
    }

    return promise;
  }

  public updateResultVisibility(completed:boolean) {
    this.showResultOverlay = !completed;
  }

  public set showListView(val:boolean) {
    this._showListView = val;
  }

  public get showListView():boolean {
    return this._showListView;
  }

  public bcfActivated() {
    return this.bcfDetectorService.isBcfActivated;
  }

  protected setupInformationLoadedListener() {
    this
      .querySpace
      .initialized
      .values$()
      .pipe(take(1))
      .subscribe(() => {
        this.tableInformationLoaded = true;
        this.cdRef.detectChanges();
      });
  }

  protected set loadingIndicator(promise:Promise<unknown>) {
    this.loadingIndicatorService.table.promise = promise;
  }

}
