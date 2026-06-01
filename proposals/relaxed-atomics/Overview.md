# Relaxed Atomics

## Summary

The Relaxed Atomics proposal introduces weaker memory orderings and spinlock relaxation hints to WebAssembly. Specifically, it adds support for release-acquire ordering, providing an intermediate memory order that is stronger than unordered accesses but weaker than the sequentially-consistent (`seqcst`) ordering introduced in the baseline [threads] proposal. Additionally, it introduces a `pause` instruction to improve the efficiency of spinlocks.

[threads]: ../threads/Overview.md

## Motivations

The baseline [threads] proposal introduced shared linear memory and atomic operations, but restricted all atomic accesses to sequentially consistent (`seqcst`) ordering. While sequential consistency simplifies reasoning about multithreaded programs, it imposes significant performance overheads on modern weak-ordered hardware architectures because it requires heavyweight synchronization barriers. However, release-acquire ordering is often sufficient to implement efficient concurrent data structures without the full cost of sequential consistency.

## Goals

- Define release-acquire memory ordering semantics for WebAssembly.
- Extend existing linear memory atomic instructions to support release-acquire ordering.
- Introduce a `pause` instruction to improve the performance and power efficiency of spinlocks.
- Allow future proposals (such as Shared-Everything Threads) to opt-in to release-acquire ordering for their respective atomic operations (e.g., WasmGC shared data accesses).

## Overview

### Memory Orderings

We introduce `acqrel` (acquire-release) as a new memory ordering.

- **Acquire reads**: A load instruction with `acqrel` ordering ensures that subsequent memory accesses cannot be reordered before it.
- **Release writes**: A store instruction with `acqrel` ordering ensures that prior memory accesses cannot be reordered after it.
- **Acquire-Release fences**: A fence instruction with `acqrel` ordering acts as both an acquire and a release barrier.
- **Acquire-Release RMWs**: Read-modify-write instructions with `acqrel` ordering perform an acquire read followed by a release write.

#### Binary Format (Memory Accesses)

For instructions that operate on linear memory and use a `memarg` immediate, we utilize bit 5 of the `memarg` flag byte to indicate the presence of an ordering immediate.

- If bit 5 of `memarg` is **0**: The instruction defaults to sequentially consistent (`seqcst`) ordering (maintaining backward compatibility with the threads proposal).
- If bit 5 of `memarg` is **1**: An ordering immediate follows the `memarg` (and follows the memory index immediate, if present).

The ordering immediate is encoded as a `u8`:

| Ordering | Encoding | Description |
|----------|----------|-------------|
| `seqcst` | `0b0000` | Sequentially Consistent |
| `acqrel` | `0b0001` | Acquire-Release |

For Read-Modify-Write (RMW) operations (including `cmpxchg`), the ordering immediate encodes both the read and write orderings:
- The **low 4 bits** encode the read ordering.
- The **high 4 bits** encode the write ordering.

Currently, RMW operations require both orderings to match (i.e., both must be `seqcst` or both must be `acqrel`). Thus, the immediate will be `0x00` for `seqcst` or `0x11` for `acqrel`.

For other atomic operations (loads, stores), the low 4 bits encode the ordering, and the high 4 bits must be 0.

#### Atomic Fences

The `atomic.fence` instruction, which previously took a reserved `0x00` byte immediate, now interprets this byte as a `u8` ordering immediate.
- `0x00` represents a `seqcst` fence.
- `0x01` represents an `acqrel` fence.

### Spinlock Relaxation: `pause`

Efficient lock implementations often employ bounded spinlocks before resorting to heavier thread blocking mechanisms. To improve the performance and power efficiency of these spinlocks, we introduce a `pause` instruction.

Semantically a no-op, `pause` provides a hint to the CPU that the execution thread is currently in a spin-loop. The engine should lower this to architecture-specific instructions that temporarily suspend execution or reduce resource consumption, such as [`PAUSE`][pause-x86] on x86 or `YIELD` on ARM.

This instruction was originally discussed during the baseline [threads] proposal (see [issue #15][threads-spinloop]) but did not make it into the initial specification. A similar primitive is also being proposed for JavaScript as [`Atomics.microwait`][tc39-microwait].

[pause-x86]: https://www.felixcloutier.com/x86/pause.html
[threads-spinloop]: https://github.com/WebAssembly/threads/issues/15
[tc39-microwait]: https://github.com/tc39/proposal-atomics-microwait

## New and Modified Instructions

### Modified Instructions (Linear Memory)

The following instructions from the [threads] proposal are extended to support the new ordering immediate:

- `i32.atomic.load`, `i64.atomic.load`, `i32.atomic.load8_u`, `i32.atomic.load16_u`, `i64.atomic.load8_u`, `i64.atomic.load16_u`, `i64.atomic.load32_u`
- `i32.atomic.store`, `i64.atomic.store`, `i32.atomic.store8`, `i32.atomic.store16`, `i64.atomic.store8`, `i64.atomic.store16`, `i64.atomic.store32`
- `i32.atomic.rmw.*`, `i64.atomic.rmw.*` (all RMW operations, e.g., `add`, `sub`, `and`, `or`, `xor`, `xchg`, `cmpxchg`)
- `atomic.fence`

### New Instructions

| Instruction | Opcode | Description |
|-------------|--------|-------------|
| `pause`     | `0xFE 0x04` | Hint to spin-loop, semantically a no-op. |
