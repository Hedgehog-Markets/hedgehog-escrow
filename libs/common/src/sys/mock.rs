use std::cell::Cell;

use solana_program::clock::Clock;

thread_local! {
    static TIMESTAMP: Cell<i64> = Cell::new(0);
}

struct MockSyscall {}

impl solana_program::program_stubs::SyscallStubs for MockSyscall {
    fn sol_get_clock_sysvar(&self, var_addr: *mut u8) -> u64 {
        let clock = Clock {
            unix_timestamp: TIMESTAMP.with(|ts| ts.get()),
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
    TIMESTAMP.with(|cell| cell.set(ts as i64));
}
