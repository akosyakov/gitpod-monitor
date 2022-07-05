import * as util from 'util';
import * as vscode from 'vscode';
import * as grpc from '@grpc/grpc-js';
import { StatusServiceClient } from '@gitpod/supervisor-api-grpc/lib/status_grpc_pb';
import { ResourcesStatuRequest } from '@gitpod/supervisor-api-grpc/lib/status_pb';

export function activate(context: vscode.ExtensionContext) {
	const statusService = new StatusServiceClient(process.env.SUPERVISOR_ADDR || 'localhost:22999', grpc.credentials.createInsecure(), {
		'grpc.primary_user_agent': `${vscode.env.appName}/${vscode.version} ${context.extension.id}/${context.extension.packageJSON.version}`,
	});
	const metadata = new grpc.Metadata();

	const units = ['KiB', 'MiB', 'GiB'];
	function humanSize(bytes: number, dp = 2) {
		const thresh = 1024;

		if (Math.abs(bytes) < thresh) {
			return bytes + ' B';
		}

		let u = -1;
		const r = 10 ** dp;

		do {
			bytes /= thresh;
			++u;
		} while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);


		return bytes.toFixed(dp) + ' ' + units[u];
	}
	const item = vscode.window.createStatusBarItem('mem', vscode.StatusBarAlignment.Left);
	let timer: NodeJS.Timeout | undefined;
	const minDelay = 2;
	const maxDelay = 30;
	const delayGrowthFactor = 1.5
	let delay = minDelay;
	async function update() {
		if (timer) {
			clearTimeout(timer);
			timer = undefined;
		}
		try {
			const status = await util.promisify(statusService.resourcesStatus.bind(statusService, new ResourcesStatuRequest(), metadata, {
				deadline: Date.now() + 5 * 1000
			}))();

			const memory = status.getMemory()!;
			const cpu = status.getCpu()!;
			const cpuStatus = cpu.getUsed() / cpu.getLimit();
			const memStatus = memory.getUsed() / memory.getLimit();
			item.text = `CPU ${(cpuStatus * 100).toFixed(2)}% MEM ${(memStatus * 100).toFixed(2)}%`;
			item.tooltip = `CPU (MILLICORES): ${cpu.getUsed()}m/${cpu.getLimit()}m\nMEMORY (BYTES): ${humanSize(memory.getUsed())}/${humanSize(memory.getLimit())}`;
			if (cpuStatus > 0.95 || memStatus > 0.95) {
				item.color = new vscode.ThemeColor('statusBarItem.errorForeground');
				item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
			} if (cpuStatus > 0.8 || memStatus > 0.8) {
				item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
				item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
			} else {
				item.color = undefined;
				item.backgroundColor = undefined;
			}
			item.show();
			delay = minDelay;
		} catch (e: any) {
			delay = delay * delayGrowthFactor;
			if (delay > maxDelay) {
				delay = maxDelay
			}
			console.error(`gitpod-monitor: failed to update, trying again in ${delay} seconds: `, + e);
		} finally {
			if (!timer) {
				timer = setTimeout(update, delay * 1000);
			}
		}
	}
	update();
	context.subscriptions.push(item);
}

export function deactivate() { }
