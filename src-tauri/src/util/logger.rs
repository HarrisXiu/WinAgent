// Logger uses env_logger (configured in lib.rs)
// This module provides helper macros if needed

#[macro_export]
macro_rules! log_info {
    ($($arg:tt)*) => {
        log::info!($($arg)*)
    };
}

#[macro_export]
macro_rules! log_error {
    ($($arg:tt)*) => {
        log::error!($($arg)*)
    };
}
