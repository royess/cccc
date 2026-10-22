//! Supported Codex JSON-RPC transports; stdio stays on the owned child pipes.
use futures_util::{Sink, SinkExt, Stream, StreamExt};
use std::io;
use std::process::{ChildStdin, ChildStdout};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio_tungstenite::tungstenite::{Error, Message};

pub(super) trait Socket:
    Stream<Item = Result<Message, Error>> + Sink<Message, Error = Error> + Unpin + Send
{
}
impl<T> Socket for T where
    T: Stream<Item = Result<Message, Error>> + Sink<Message, Error = Error> + Unpin + Send
{
}
pub(super) enum Transport {
    WebSocket(Box<dyn Socket>),
    Stdio {
        reader: BufReader<tokio::fs::File>,
        writer: tokio::fs::File,
        buffer: Vec<u8>,
    },
}
impl Transport {
    #[cfg(unix)]
    pub(super) fn stdio(stdin: ChildStdin, stdout: ChildStdout) -> Self {
        use std::os::fd::OwnedFd;
        Self::Stdio {
            reader: BufReader::new(tokio::fs::File::from_std(std::fs::File::from(
                OwnedFd::from(stdout),
            ))),
            writer: tokio::fs::File::from_std(std::fs::File::from(OwnedFd::from(stdin))),
            buffer: Vec::new(),
        }
    }
    pub(super) async fn send(&mut self, message: Message) -> Result<(), Error> {
        match self {
            Self::WebSocket(socket) => socket.send(message).await,
            Self::Stdio { writer, .. } => {
                if let Message::Text(text) = message {
                    writer.write_all(text.as_bytes()).await?;
                    writer.write_all(b"\n").await?;
                    writer.flush().await?;
                }
                Ok(())
            }
        }
    }
    pub(super) async fn next(&mut self) -> Option<Result<Message, Error>> {
        match self {
            Self::WebSocket(socket) => socket.next().await,
            Self::Stdio { reader, buffer, .. } => {
                let result = reader
                    .take(((64 << 20) + 1 - buffer.len()) as u64)
                    .read_until(b'\n', buffer)
                    .await;
                match result {
                    Ok(0) => None,
                    Ok(_) if buffer.len() > 64 << 20 || !buffer.ends_with(b"\n") => {
                        Some(Err(Error::Io(io::Error::new(
                            io::ErrorKind::InvalidData,
                            "invalid or oversized app-server stdio frame",
                        ))))
                    }
                    Ok(_) => Some(
                        String::from_utf8(std::mem::take(buffer))
                            .map(|v| Message::Text(v.into()))
                            .map_err(|_| {
                                Error::Io(io::Error::new(
                                    io::ErrorKind::InvalidData,
                                    "app-server stdio is not UTF-8",
                                ))
                            }),
                    ),
                    Err(error) => Some(Err(Error::Io(error))),
                }
            }
        }
    }
    pub(super) async fn close(&mut self) -> Result<(), Error> {
        match self {
            Self::WebSocket(socket) => socket.close().await,
            Self::Stdio { writer, .. } => writer.shutdown().await.map_err(Error::Io),
        }
    }
}
