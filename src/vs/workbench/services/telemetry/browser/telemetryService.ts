/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApplicationInsights } from '@microsoft/applicationinsights-web';
import { ITelemetryService, ITelemetryInfo, ITelemetryData } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService, combinedAppender, ITelemetryAppender } from 'vs/platform/telemetry/common/telemetryUtils';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { Disposable } from 'vs/base/common/lifecycle';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { ILoggerService } from 'vs/platform/log/common/log';
import { TelemetryService as BaseTelemetryService, ITelemetryServiceConfig } from 'vs/platform/telemetry/common/telemetryService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ClassifiedEvent, StrictPropertyCheck, GDPRClassification } from 'vs/platform/telemetry/common/gdprTypings';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { resolveWorkbenchCommonProperties } from 'vs/workbench/services/telemetry/browser/workbenchCommonProperties';
import { IProductService } from 'vs/platform/product/common/productService';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { TelemetryLogAppender } from 'vs/platform/telemetry/common/telemetryLogAppender';

class WebAppInsightsAppender implements ITelemetryAppender {
	private _aiClient: ApplicationInsights | undefined;

	constructor(private _eventPrefix: string, aiKey: string) {
		const endpointUrl = 'https://vortex.data.microsoft.com/collect/v1';
		this._aiClient = new ApplicationInsights({
			config: {
				instrumentationKey: aiKey,
				endpointUrl,
				disableAjaxTracking: true,
				disableExceptionTracking: true,
				disableFetchTracking: true,
				disableCorrelationHeaders: true,
				disableCookiesUsage: true,
				autoTrackPageVisitTime: false,
				emitLineDelimitedJson: true,
			},
		});
		this._aiClient.loadAppInsights();

		// If we cannot access the endpoint this most likely means it's being blocked
		// and we should not attempt to send any telemetry.
		fetch(endpointUrl).catch(() => (this._aiClient = undefined));
	}

	/**
	 * Logs a telemetry event with eventName and data
	 * @param eventName The event name
	 * @param data The data associated with the events
	 */
	public log(eventName: string, data: any): void {
		if (!this._aiClient) {
			return;
		}

		this._aiClient.trackEvent({ name: this._eventPrefix + '/' + eventName }, data);
	}

	/**
	 * Flushes all the telemetry data still in the buffer
	 */
	public flush(): Promise<any> {
		if (this._aiClient) {
			this._aiClient.flush();
			this._aiClient = undefined;
		}
		return Promise.resolve(undefined);
	}
}

class WebTelemetryAppender implements ITelemetryAppender {

	constructor(private _appender: ITelemetryAppender) { }

	log(eventName: string, data: any): void {
		this._appender.log(eventName, data);
	}

	flush(): Promise<void> {
		return this._appender.flush();
	}
}

export class TelemetryService extends Disposable implements ITelemetryService {

	declare readonly _serviceBrand: undefined;

	private impl: ITelemetryService;
	public readonly sendErrorTelemetry = false;

	constructor(
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@ILoggerService loggerService: ILoggerService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
		@IProductService productService: IProductService,
		@IRemoteAgentService remoteAgentService: IRemoteAgentService
	) {
		super();

		if (!!productService.enableTelemetry && productService.aiConfig?.asimovKey && environmentService.isBuilt) {
			// If remote server is present send telemetry through that, else use the client side appender
			const telemetryProvider: ITelemetryAppender = remoteAgentService.getConnection() !== null ? { log: remoteAgentService.logTelemetry.bind(remoteAgentService), flush: remoteAgentService.flushTelemetry.bind(remoteAgentService) } : new WebAppInsightsAppender('monacoworkbench', productService.aiConfig?.asimovKey);
			const config: ITelemetryServiceConfig = {
				appender: combinedAppender(new WebTelemetryAppender(telemetryProvider), new TelemetryLogAppender(loggerService, environmentService)),
				commonProperties: resolveWorkbenchCommonProperties(storageService, productService.commit, productService.version, environmentService.remoteAuthority, productService.embedderIdentifier, environmentService.options && environmentService.options.resolveCommonTelemetryProperties),
				sendErrorTelemetry: false,
			};

			this.impl = this._register(new BaseTelemetryService(config, configurationService));
		} else {
			this.impl = NullTelemetryService;
		}
	}

	setEnabled(value: boolean): void {
		return this.impl.setEnabled(value);
	}

	setExperimentProperty(name: string, value: string): void {
		return this.impl.setExperimentProperty(name, value);
	}

	get isOptedIn(): boolean {
		return this.impl.isOptedIn;
	}

	publicLog(eventName: string, data?: ITelemetryData, anonymizeFilePaths?: boolean): Promise<void> {
		return this.impl.publicLog(eventName, data, anonymizeFilePaths);
	}

	publicLog2<E extends ClassifiedEvent<T> = never, T extends GDPRClassification<T> = never>(eventName: string, data?: StrictPropertyCheck<T, E>, anonymizeFilePaths?: boolean) {
		return this.publicLog(eventName, data as ITelemetryData, anonymizeFilePaths);
	}

	publicLogError(errorEventName: string, data?: ITelemetryData): Promise<void> {
		return this.impl.publicLog(errorEventName, data);
	}

	publicLogError2<E extends ClassifiedEvent<T> = never, T extends GDPRClassification<T> = never>(eventName: string, data?: StrictPropertyCheck<T, E>) {
		return this.publicLogError(eventName, data as ITelemetryData);
	}

	getTelemetryInfo(): Promise<ITelemetryInfo> {
		return this.impl.getTelemetryInfo();
	}
}

registerSingleton(ITelemetryService, TelemetryService);
