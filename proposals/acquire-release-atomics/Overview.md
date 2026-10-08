# Acquire-Release Atomics

## Summary

The Acquire-Release Atomics proposal introduces weaker memory orderings and spinlock relaxation hints to WebAssembly. Specifically, it adds support for release-acquire ordering, providing an intermediate memory order that is stronger than unordered accesses but weaker than the sequentially-consistent (`seqcst`) ordering introduced in the baseline [threads] proposal. Additionally, it introduces a `pause` instruction to improve the efficiency of spinlocks.

[threads]: ../threads/Overview.md

## Motivations

The baseline [threads] proposal introduced shared linear memory and atomic operations, but restricted all atomic accesses to sequentially consistent (`seqcst`) ordering. While sequential consistency simplifies reasoning about multithreaded programs, it imposes significant performance overheads on modern weak-ordered hardware architectures because it requires heavyweight synchronization barriers.

To improve performance for linear memory languages using threading (e.g., C, C++, and Rust), and to lay the groundwork for compiling languages targeting WasmGC that have stronger memory models (e.g., Java and OCaml), release-acquire ordering is introduced. It provides an intermediate memory order that is stronger than unordered accesses but weaker than sequential consistency, which is often sufficient to implement efficient concurrent data structures without the full cost of sequential consistency.

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

> Note: We may want to add separate `acquire` and `release` orderings to express weaker fences.

#### Binary Format (Memory Accesses)

For instructions that operate on linear memory and use a `memarg` immediate, we utilize bit 4 (`0x10`) of the `memarg` flags `u32` immediate to indicate the presence of an ordering immediate:

- If bit 4 of `flags` is **0**: No ordering immediate is present, and the instruction defaults to sequentially consistent (`seqcst`) ordering (maintaining backward compatibility with the threads proposal).
- If bit 4 of `flags` is **1**: A `u8` ordering immediate is encoded after `flags` (and after the `memidx` or `typeidx`[^multibyte] immediate, if bit 5 or 6 is set) and before `offset`:
  ```
  memarg ::= flags:u32 [memidx:u32 | typeidx:u32] [ordering:u8] offset:u32
  ```

It is a decode/parse error (malformed module) if bit 4 of `flags` is set for any non-atomic instruction that uses a `memarg` (such as standard loads and stores).

The ordering immediate is encoded as a `u8`:

| Ordering | Encoding | Description |
|----------|----------|-------------|
| `seqcst` | `0b0000` | Sequentially Consistent |
| `acqrel` | `0b0001` | Acquire-Release |

For Read-Modify-Write (RMW) operations (including `cmpxchg`), the ordering immediate encodes both the read and write orderings:
- The **low 4 bits** encode the read ordering.
- The **high 4 bits** encode the write ordering.

Currently, RMW operations require both orderings to match (i.e., both must be `seqcst` or both must be `acqrel`). Thus, the immediate will be `0x00` for `seqcst` or `0x11` for `acqrel`.

> Note: We may also want to give cmpxchg a third ordering, since some compilation schemes are able to give its read different orderings depending on whether it succeeds or fails.

For other atomic operations (loads, stores), the low 4 bits encode the ordering, and the high 4 bits must be 0.

#### Atomic Fences

The `atomic.fence` instruction, which previously took a reserved `0x00` byte immediate, now interprets this byte as a `u8` ordering immediate.
- `0x00` represents a `seqcst` fence.
- `0x01` represents an `acqrel` fence.

#### Text Format Syntax

In the text format, an optional `ordering` keyword immediate (`seqcst` or `acqrel`, defaulting to `seqcst` if omitted) may be specified on atomic instructions. For memory atomic instructions, the optional ordering immediate follows the optional memory index (`$mem`) or array type (`(type $t)`)[^multibyte] immediate and precedes any `offset=N` or `align=N` immediates:

```wat
;; Atomic Load
(i32.atomic.load [$mem | (type $t)] [ordering] [offset=N] [align=N] ...)

;; Atomic Store
(i32.atomic.store [$mem | (type $t)] [ordering] [offset=N] [align=N] ...)

;; Atomic RMW
(i32.atomic.rmw.add [$mem | (type $t)] [ordering] [offset=N] [align=N] ...)

;; Atomic Cmpxchg
(i32.atomic.rmw.cmpxchg [$mem | (type $t)] [ordering] [offset=N] [align=N] ...)

;; Atomic Fence
(atomic.fence [ordering])
```

[^multibyte]: The `typeidx` immediate (`(type $t)` in the text format) and bit 5 of `flags` are defined by the [multibyte-array-access](https://github.com/WebAssembly/multibyte-array-access) proposal.

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
