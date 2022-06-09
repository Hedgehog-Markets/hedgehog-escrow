/// Hint to the compiler to assume the given predicate is `true`.
#[macro_export]
macro_rules! assume {
    ($pred:expr) => {{
        if !$pred {
            ::std::hint::unreachable_unchecked();
        }
    }};
}

// This split approach allows us to provide better compiler errors.

/// Asserts that a condition is `true` at compile-time.
#[macro_export]
macro_rules! static_assert {
    ($cond:expr $(,)?) => {
        // The Solana rust toolchain doesn't yet support const panic, this
        // macro takes advantage of const evaluation. In the case that the
        // condition evaluates as false, the macro expands to:
        //   `const _: [(); 1] = [];`
        // this causes the compiler to fail.
        #[$crate::_private::rustversion::before(1.57)]
        const _: [(); !{
            const COND: bool = $cond;
            COND
        } as usize] = [];

        #[$crate::_private::rustversion::since(1.57)]
        const _: () = {
            if !$cond {
                ::std::panic!(concat!("static assertion failed: ", stringify!($cond)));
            }
        };
    };
    ($cond:expr, $($msg:tt)+ $(,)?) => {
        // The Solana rust toolchain doesn't yet support const panic, this
        // macro takes advantage of const evaluation. In the case that the
        // condition evaluates as false, the macro expands to:
        //   `const _: [(); 1] = [];`
        // this causes the compiler to fail.
        #[$crate::_private::rustversion::before(1.57)]
        const _: [(); !{
            const COND: bool = $cond;
            COND
        } as usize] = [];

        #[$crate::_private::rustversion::since(1.57)]
        const _: () = {
            if !$cond {
                ::std::panic!($($msg)+);
            }
        };
    };
}
