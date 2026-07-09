(module
  (memory 1 1)
;;   (memory i32 1 1)
;;   (memory i64 1 1)

  ;; Memory index must come before memory ordering if present.
  ;; Both immediates are optional; an omitted memory ordering will be treated as seqcst.
  (func $test-all-ops
    (drop (i32.atomic.load (i32.const 0)))
    (drop (i32.atomic.load acqrel (i32.const 0)))
    (drop (i32.atomic.load seqcst (i32.const 0)))
  )
)