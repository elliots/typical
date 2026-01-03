package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/elliots/typical/packages/compiler/internal/server"
)

func main() {
	os.Exit(run())
}

func run() int {
	fs := flag.NewFlagSet("typical", flag.ContinueOnError)
	cwd := fs.String("cwd", mustGetwd(), "current working directory")

	if err := fs.Parse(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}

	s := server.New(&server.Options{
		In:  os.Stdin,
		Out: os.Stdout,
		Err: os.Stderr,
		Cwd: *cwd,
	})

	if err := s.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}

	return 0
}

func mustGetwd() string {
	cwd, err := os.Getwd()
	if err != nil {
		panic(err)
	}
	return cwd
}
