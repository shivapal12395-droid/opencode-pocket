#include <jni.h>
#include <cstring>
#include <string>
#include <vector>
#include <map>
#include <mutex>
#include <unistd.h>
#include <sys/wait.h>
#include <sys/select.h>
#include <fcntl.h>
#include <signal.h>
#include <errno.h>

namespace {
std::mutex g_mu;
std::map<jlong, pid_t> g_pids;
std::map<jlong, int> g_fds;

std::vector<std::string> toStrings(JNIEnv *env, jobjectArray arr) {
  std::vector<std::string> out;
  if (!arr) return out;
  const jsize n = env->GetArrayLength(arr);
  for (jsize i = 0; i < n; i++) {
    jstring s = static_cast<jstring>(env->GetObjectArrayElement(arr, i));
    if (!s) continue;
    const char *c = env->GetStringUTFChars(s, nullptr);
    if (c) out.emplace_back(c);
    env->ReleaseStringUTFChars(s, c);
  }
  return out;
}

char **toArgv(const std::vector<std::string> &v) {
  char **a = static_cast<char **>(calloc(v.size() + 1, sizeof(char *)));
  for (size_t i = 0; i < v.size(); i++) a[i] = strdup(v[i].c_str());
  return a;
}
void freeArgv(char **a) {
  if (!a) return;
  for (size_t i = 0; a[i]; i++) free(a[i]);
  free(a);
}
}  // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_com_shivapal_opencodepocket_NativeLauncher_start(JNIEnv *env, jclass,
                                                       jobjectArray argv,
                                                       jobjectArray envp) {
  auto args = toStrings(env, argv);
  auto envs = toStrings(env, envp);
  if (args.empty()) return -1;

  int pipefd[2];
  if (pipe(pipefd) != 0) return -1;
  fcntl(pipefd[0], F_SETFL, O_NONBLOCK);

  pid_t pid = fork();
  if (pid == 0) {
    close(pipefd[0]);
    dup2(pipefd[1], STDOUT_FILENO);
    dup2(pipefd[1], STDERR_FILENO);
    close(pipefd[1]);
    char **av = toArgv(args);
    char **ev = toArgv(envs);
    execve(av[0], av, ev);
    // execve only returns on failure
    dprintf(STDERR_FILENO, "execve failed: %s\n", strerror(errno));
    freeArgv(av);
    freeArgv(ev);
    _exit(127);
  }
  close(pipefd[1]);
  if (pid < 0) {
    close(pipefd[0]);
    return -1;
  }
  std::lock_guard<std::mutex> lock(g_mu);
  g_pids[static_cast<jlong>(pid)] = pid;
  g_fds[static_cast<jlong>(pid)] = pipefd[0];
  return static_cast<jlong>(pid);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_shivapal_opencodepocket_NativeLauncher_read(JNIEnv *env, jclass,
                                                      jlong handle,
                                                      jint timeoutMs) {
  int fd = -1;
  {
    std::lock_guard<std::mutex> lock(g_mu);
    auto it = g_fds.find(handle);
    if (it == g_fds.end()) return env->NewStringUTF("");
    fd = it->second;
  }
  std::string out;
  fd_set rfds;
  FD_ZERO(&rfds);
  FD_SET(fd, &rfds);
  struct timeval tv { timeoutMs / 1000, (timeoutMs % 1000) * 1000 };
  int ready = select(fd + 1, &rfds, nullptr, nullptr, &tv);
  if (ready > 0) {
    char buf[8192];
    while (true) {
      ssize_t n = read(fd, buf, sizeof(buf));
      if (n > 0) {
        out.append(buf, static_cast<size_t>(n));
        if (out.size() > (1u << 20)) break;
      } else {
        break;
      }
    }
  }
  return env->NewStringUTF(out.c_str());
}

extern "C" JNIEXPORT jint JNICALL
Java_com_shivapal_opencodepocket_NativeLauncher_wait(JNIEnv *, jclass,
                                                      jlong handle) {
  pid_t pid = -1;
  int fd = -1;
  {
    std::lock_guard<std::mutex> lock(g_mu);
    auto p = g_pids.find(handle);
    auto f = g_fds.find(handle);
    if (p == g_pids.end()) return -1;
    pid = p->second;
    if (f != g_fds.end()) { fd = f->second; }
  }
  int status = 0;
  while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
  if (fd >= 0) close(fd);
  {
    std::lock_guard<std::mutex> lock(g_mu);
    g_pids.erase(handle);
    g_fds.erase(handle);
  }
  return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}

extern "C" JNIEXPORT void JNICALL
Java_com_shivapal_opencodepocket_NativeLauncher_stop(JNIEnv *, jclass,
                                                      jlong handle) {
  pid_t pid = -1;
  {
    std::lock_guard<std::mutex> lock(g_mu);
    auto p = g_pids.find(handle);
    if (p == g_pids.end()) return;
    pid = p->second;
  }
  kill(pid, SIGTERM);
}
