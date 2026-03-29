import { createSignal, type Accessor, type Setter } from 'solid-js';
import { ANIM, type SpringParams } from './config';
import { registerSpring, unregisterSpring } from './loop';

export class Spring {
  private _value: number;
  private _velocity: number;
  private _target: number;
  private _settled: boolean;

  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;

  // SolidJS signal for reactive DOM binding
  readonly signal: Accessor<number>;
  private readonly setSignal: Setter<number>;

  constructor(initial: number, params: SpringParams = ANIM.bbox) {
    this._value = initial;
    this._velocity = 0;
    this._target = initial;
    this._settled = true;

    this.stiffness = params.stiffness;
    this.damping = params.damping;
    this.mass = params.mass;

    const [signal, setSignal] = createSignal(initial);
    this.signal = signal;
    this.setSignal = setSignal;

    registerSpring(this);
  }

  get value(): number {
    return this._value;
  }

  get target(): number {
    return this._target;
  }

  get settled(): boolean {
    return this._settled;
  }

  setTarget(target: number): void {
    if (target === this._target && this._settled) return;
    this._target = target;
    this._settled = false;
  }

  /** Instantly set value without animation */
  snap(value: number): void {
    this._value = value;
    this._velocity = 0;
    this._target = value;
    this._settled = true;
    this.setSignal(value);
  }

  /** Advance one tick. Returns true if still active. */
  tick(dt: number): boolean {
    if (this._settled) return false;

    const displacement = this._target - this._value;
    const acceleration = (this.stiffness * displacement - this.damping * this._velocity) / this.mass;

    this._velocity += acceleration * dt;
    this._value += this._velocity * dt;

    if (Math.abs(this._velocity) < ANIM.epsilon && Math.abs(displacement) < ANIM.epsilon) {
      this._value = this._target;
      this._velocity = 0;
      this._settled = true;
    }

    this.setSignal(this._value);
    return !this._settled;
  }

  dispose(): void {
    unregisterSpring(this);
  }
}
