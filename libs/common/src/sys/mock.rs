use std::sync::atomic::{AtomicU64, Ordering};

use solana_program::clock::Clock;

static TIMESTAMP: AtomicU64 = AtomicU64::new(0);

struct MockSyscall {}

impl solana_program::program_stubs::SyscallStubs for MockSyscall {
    fn sol_get_clock_sysvar(&self, var_addr: *mut u8) -> u64 {
        let clock = Clock {
            unix_timestamp: TIMESTAMP.load(Ordering::Relaxed) as i64,
            ..Default::default()
        };

        unsafe { *(var_addr as *mut Clock) = clock };

        solana_program::entrypoint::SUCCESS
    }
}

fn install_mock() {
    use std::sync::Once;

    static ONCE: Once = Once::new();

    ONCE.call_once(|| {
        solana_program::program_stubs::set_syscall_stubs(Box::new(MockSyscall {}));
    });
}

/// Mock timestamp for use in tests.
pub fn timestamp(ts: u64) {
    install_mock();
    TIMESTAMP.store(ts, Ordering::Relaxed);
}
