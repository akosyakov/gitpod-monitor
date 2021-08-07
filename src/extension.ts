import * as fs from 'fs/promises';
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
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
	const shortFormat = 'WorkingSet(Usage - TotalInactive)/Limit Mem%';
	const longFormat = 'WorkingSet(Usage - TotalInactive)/Limit Mem% TotalRSS TotalCache';
	let format = shortFormat;
	const item = vscode.window.createStatusBarItem('mem', vscode.StatusBarAlignment.Left);
	item.tooltip = format;
	item.command = 'gitpod-monitor.toggleFormat';
	let timer: NodeJS.Timeout | undefined;
	async function update() {
		if (timer) {
			clearTimeout(timer);
			timer = undefined;
		}
		try {
			// see https://github.com/kubernetes/kubernetes/blob/d5e5f14508b02997b117ca9214b2fa349e57d0f9/test/e2e/node/node_problem_detector.go#L259-L293
			let usageInBytes = Number((await fs.readFile('/sys/fs/cgroup/memory/memory.usage_in_bytes', { encoding: 'utf8' })).trim());
			const limitInBytes = Number((await fs.readFile('/sys/fs/cgroup/memory/memory.limit_in_bytes', { encoding: 'utf8' })).trim());
			const statRaw = (await fs.readFile('/sys/fs/cgroup/memory/memory.stat', { encoding: 'utf8' })).trim();
			const lines = statRaw.split('\n');
			const stat: {
				[key: string]: string
			} = {};
			for (const line of lines) {
				const [key, value] = line.split(' ');
				stat[key] = value;
			}
			// substract evictable memory
			const totalInactiveFile = Number(stat['total_inactive_file']);
			if (usageInBytes < totalInactiveFile) {
				usageInBytes = 0;
			} else {
				usageInBytes -= totalInactiveFile;
			}

			const mem = usageInBytes / limitInBytes;
			let value = format
				.replace('WorkingSet(Usage - TotalInactive)', humanSize(usageInBytes))
				.replace('Limit', humanSize(limitInBytes))
				.replace('Mem', (mem * 100).toFixed(2));
			if (format === longFormat) {
				const cacheInBytes = Number(stat['total_cache']);
				const rssInBytes = Number(stat['total_rss']);
				value = value
					.replace('TotalCache', humanSize(cacheInBytes))
					.replace('TotalRSS', humanSize(rssInBytes));
			}
			item.text = value;
			if (mem > 0.85) {
				item.color = new vscode.ThemeColor('statusBarItem.errorForeground');
				item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
			} if (mem > 0.5) {
				item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
				item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
			} else {
				item.color = undefined;
				item.backgroundColor = undefined;
			}
			item.show();
		} finally {
			if (!timer) {
				timer = setTimeout(update, 2000);
			}
		}
	}
	update();
	context.subscriptions.push(item);
	context.subscriptions.push(vscode.commands.registerCommand('gitpod-monitor.toggleFormat', () => {
		format = format === shortFormat ? longFormat : shortFormat;
		item.tooltip = format;
		update();
	}));
}

export function deactivate() { }
