import { I18n } from "./i18n";

const MIN_BASE_SPEED = 0.02 / 16;
const MAX_BASE_SPEED = 3 / 16;

export class ProgressStatusBar {
	private currentPercentage = 0;
	private targetPercentage = 0;
	private frameId: number | null = null;
	private lastFrameTime: number | null = null;
	private displayedPercentage = 0;
	private baseSpeed = 0;
	private lastTargetUpdateTime: number | null = null;
	private progressFinished = false;
	private totalProgressSteps = 0;
	private completedProgressSteps = 0;

	constructor(private statusBarItem: HTMLElement) {
		this.statusBarItem.addClass("local-gpt-status");
		this.statusBarItem.hide();
	}

	initialize() {
		this.totalProgressSteps = 0;
		this.completedProgressSteps = 0;
		this.currentPercentage = 0;
		this.targetPercentage = 0;
		this.displayedPercentage = 0;
		this.baseSpeed = 0;
		this.lastTargetUpdateTime = null;
		this.lastFrameTime = null;
		this.progressFinished = false;
		this.stopAnimation();
		this.statusBarItem.show();
		this.updateStatusBar();
	}

	addTotalProgressSteps(steps: number) {
		this.totalProgressSteps += steps;
		this.updateProgressBar();
	}

	updateCompletedSteps(steps: number) {
		this.completedProgressSteps += steps;
		if (this.completedProgressSteps > this.totalProgressSteps) {
			this.totalProgressSteps = this.completedProgressSteps;
		}
		this.updateProgressBar();
	}

	hide() {
		this.statusBarItem.hide();
		this.totalProgressSteps = 0;
		this.completedProgressSteps = 0;
		this.currentPercentage = 0;
		this.targetPercentage = 0;
		this.displayedPercentage = 0;
		this.baseSpeed = 0;
		this.lastTargetUpdateTime = null;
		this.lastFrameTime = null;
		this.progressFinished = false;
		this.stopAnimation();
	}

	markFinished() {
		if (this.progressFinished) {
			return;
		}
		this.progressFinished = true;
		this.currentPercentage = 100;
		this.displayedPercentage = 100;
		this.targetPercentage = 100;
		this.updateStatusBar();
	}

	dispose() {
		this.stopAnimation();
	}

	private updateProgressBar() {
		const newTarget = this.calculateTargetPercentage();
		if (newTarget === this.targetPercentage) {
			return;
		}
		const now = performance.now();
		this.baseSpeed = this.calculateBaseSpeed(newTarget, now);
		this.targetPercentage = newTarget;
		this.lastTargetUpdateTime = now;
		this.ensureAnimationLoop();
	}

	private calculateTargetPercentage(): number {
		if (this.totalProgressSteps <= 0) {
			return 0;
		}
		const ratio = Math.min(
			this.completedProgressSteps / this.totalProgressSteps,
			1,
		);
		return Math.floor(ratio * 100);
	}

	private calculateBaseSpeed(newTarget: number, now: number): number {
		if (this.lastTargetUpdateTime === null) {
			return this.baseSpeed;
		}
		const dt = now - this.lastTargetUpdateTime;
		const diff = newTarget - this.targetPercentage;
		if (dt <= 0 || diff <= 0) {
			return this.baseSpeed;
		}
		const instantaneous = diff / dt;
		const blended =
			this.baseSpeed === 0
				? instantaneous
				: this.baseSpeed * 0.75 + instantaneous * 0.25;

		return Math.min(MAX_BASE_SPEED, Math.max(MIN_BASE_SPEED, blended));
	}

	private ensureAnimationLoop() {
		if (this.frameId !== null) {
			return;
		}
		this.lastFrameTime = null;
		this.frameId = requestAnimationFrame(this.animationLoop);
	}

	private updateStatusBar() {
		const shown = this.progressFinished
			? this.currentPercentage
			: Math.min(this.currentPercentage, 99);
		this.statusBarItem.setAttr(
			"data-text",
			shown
				? I18n.t("statusBar.enhancingWithProgress", {
						percent: String(shown),
					})
				: I18n.t("statusBar.enhancing"),
		);
		this.statusBarItem.setText(` `);
	}

	private animationLoop = (time: number) => {
		if (this.lastFrameTime === null) {
			this.lastFrameTime = time;
		}
		const delta = time - this.lastFrameTime;
		this.lastFrameTime = time;
		const target = this.targetPercentage;
		if (delta > 0 && this.displayedPercentage < target) {
			let speed = this.baseSpeed;
			if (speed === 0) {
				speed = (target - this.displayedPercentage) / 400;
			}
			this.displayedPercentage = Math.min(
				target,
				this.displayedPercentage + speed * delta,
			);
			const rounded = Math.floor(this.displayedPercentage);
			if (rounded !== this.currentPercentage) {
				this.currentPercentage = rounded;
				this.updateStatusBar();
			}
		}
		if (this.displayedPercentage >= target) {
			this.displayedPercentage = target;
			this.currentPercentage = target;
			this.updateStatusBar();
		}
		if (
			this.currentPercentage < this.targetPercentage ||
			this.displayedPercentage < this.targetPercentage
		) {
			this.frameId = requestAnimationFrame(this.animationLoop);
			return;
		}
		this.stopAnimation();
	};

	private stopAnimation() {
		if (this.frameId !== null) {
			cancelAnimationFrame(this.frameId);
		}
		this.frameId = null;
		this.lastFrameTime = null;
	}
}
